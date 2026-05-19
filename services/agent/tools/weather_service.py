import os
import time
import requests
import logging
from typing import Any, Dict
from datetime import datetime, timezone, timedelta
from smart_home.core.agent import Tool
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

class WeatherTool(Tool):

    def __init__(self):
        # Get timezone info for tool description
        tz_env = os.getenv("TIMEZONE", "").strip()
        if tz_env:
            local_timezone = tz_env
        else:
            # Auto-detect from system
            now = datetime.now().astimezone()
            tz_name = now.tzname()  # e.g., "EST" or "EDT"
            tz_offset = now.strftime("%z")  # e.g., "-0500"
            tz_offset_formatted = f"{tz_offset[:3]}:{tz_offset[3:]}"
            local_timezone = f"{tz_name} (UTC{tz_offset_formatted})"

        name = "get_weather"
        description = (
            f"Get weather information from weather.gov with control over time. "
            f"Your local timezone is {local_timezone}. "
            f"ALWAYS use your local timezone in timestamps (e.g., '2025-11-12T18:00:00-05:00'), NEVER use UTC unless explicitly requested."
        )
        params = {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "Either 'home' or 'lat,lon' (e.g., '38.9,-77.0').",
                    "default": "home"
                },
                "granularity": {
                    "type": "string",
                    "enum": ["hourly","daily"],
                    "description": "Whether to return day/night data or hourly data. Only use hourly if specifically requested. To get night data use 11pm. To get day data, use noon",
                    "default": "daily"
                },
                "forecast_times_iso": {
                    "type": "string",
                    "description": f"ISO-8601 timestamp in LOCAL TIMEZONE {local_timezone} with offset (e.g., '2025-11-12T18:00:00-05:00'). MUST include timezone offset. NEVER use UTC (e.g., '...Z') unless explicitly requested. For current weather, use 'now'.",
                    "default":"now"
                },
            },
            "required": ["location", "forecast_times_iso", "granularity"]
        }
        super().__init__(name, description, params)

        self.session = requests.Session()
        self.base = "https://api.weather.gov"
        self.timeout = 8.0
        self.user_agent = os.getenv(
            "WEATHER_USER_AGENT",
            "SmartHomeAssistant/1.0 (contact: you@example.com)"
        )
        self.home_grid = os.getenv("HOME_GRID", "").strip()

        self.session.headers.update({
            "User-Agent": self.user_agent,
            "Accept": "application/ld+json, application/json"
        })

    def call(
        self,
        granularity: str = "daily",
        forecast_times_iso: str = "now",
        location: str = "home",
    ) -> str:
        try:
            # Validate timestamp format
            if forecast_times_iso.lower() != "now":
                # Check if timestamp has timezone info
                if not ('+' in forecast_times_iso or '-' in forecast_times_iso.split('T')[-1] or forecast_times_iso.endswith('Z')):
                    # Try to parse and add local timezone as fallback
                    try:
                        dt_naive = datetime.fromisoformat(forecast_times_iso)
                        # Get system timezone
                        from datetime import datetime as dt_class
                        local_tz = dt_class.now().astimezone().tzinfo
                        dt_aware = dt_naive.replace(tzinfo=local_tz)
                        forecast_times_iso = dt_aware.isoformat()
                        logger.warning(
                            f"Timestamp was missing timezone, added local timezone: {forecast_times_iso}",
                            extra={"tool_name": "get_weather", "original": forecast_times_iso}
                        )
                    except Exception as e:
                        return f"Error: Timestamp must include timezone offset (e.g., '2025-11-12T18:00:00-05:00' or end with 'Z'). Got: '{forecast_times_iso}'. Please provide a complete ISO-8601 timestamp with timezone."

            lat, lon, grid = self._resolve_location(location)
            # Build forecast URLs
            if grid:
                grid_id, grid_x, grid_y = grid
                forecast_url = f"{self.base}/gridpoints/{grid_id}/{grid_x},{grid_y}/forecast"
                hourly_url = f"{forecast_url}/hourly"
            else:
                points = self._points(lat, lon)
                forecast_url = points["forecast"]
                hourly_url = points["forecastHourly"]

            if granularity == "hourly":
                hourly = self._get_json(hourly_url)
                summary_str = summarize_nws_hourly(
                    hourly["periods"],
                    forecast_times_iso,
                    units="F",
                )
            else:  # "daily" (default)
                daily = self._get_json(forecast_url)
                summary_str = summarize_nws_daily(
                    daily["periods"],
                    forecast_times_iso,
                    units="F",
                )

            logger.info(
                f"Weather forecast retrieved for {location}",
                extra={"tool_name": "get_weather", "location": location, "granularity": granularity}
            )
            return summary_str

        except Exception as e:
            logger.error(
                f"WeatherTool error: {e}",
                exc_info=True,
                extra={"tool_name": "get_weather", "location": location}
            )
            return f"Error: {e}"


    # ----- resolution / http -----
    def _resolve_location(self, location: str):
        if location.lower() == "home":
            if self.home_grid and self.home_grid.count(",") == 2:
                grid_id, x_s, y_s = [p.strip() for p in self.home_grid.split(",")]
                return None, None, (grid_id, int(x_s), int(y_s))
            raise ValueError("Home location not configured correctly (set HOME_GRID env var).")
        if "," in location:
            lat_s, lon_s = location.split(",", 1)
            return float(lat_s.strip()), float(lon_s.strip()), None
        raise ValueError("Provide 'home' or explicit 'lat,lon' (geocoding not enabled).")

    def _points(self, lat: float, lon: float) -> Dict[str, Any]:
        url = f"{self.base}/points/{lat:.4f},{lon:.4f}"
        return self._get_json(url)

    def _get_json(self, url: str) -> Dict[str, Any]:
        last = None
        for i in range(3):
            try:
                r = self.session.get(url, timeout=self.timeout)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                logger.debug(
                    f"Weather API request retry {i+1}/3",
                    extra={"tool_name": "get_weather", "url": url, "error": str(e)}
                )
                last = e
                time.sleep(0.25 * (i + 1))
        raise last

# ----- shaping -----
def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)

def _hour_key_utc(dt: datetime) -> datetime:
    """Convert to UTC and round to the top of the hour; keep tz-aware UTC."""
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0, tzinfo=timezone.utc)

def _c_to_f(c: float | None) -> float | None:
    return None if c is None else (c * 9 / 5 + 32)

def _fmt_temp(c: float | None, currUnits: str, units: str = "F") -> str:
    if currUnits.lower() == units.lower():
        return f"{c}{units}"
    if c is None:
        return "—"
    return f"{round(_c_to_f(c))}°F" if units.upper() == "F" else f"{round(c)}°C"

def _fmt_percent(v) -> str:
    try:
        return f"{int(round(float(v)))}%"
    except Exception:
        return "—"

def _time_label(dt: datetime) -> str:
    """Format datetime with timezone abbreviation (e.g., 'Thu 8 AM EST')."""
    try:
        # Unix-style formatting with timezone
        return dt.strftime("%a %-I %p %Z")
    except ValueError:
        # Windows-style formatting with timezone
        return dt.strftime("%a %#I %p %Z")


# --------------------------------
# Single-period: HOURLY (one hour)
# --------------------------------
def summarize_hour(period: dict, units: str = "F") -> str:
    """Concise, single-line summary for one hourly NWS period."""
    start = _parse_iso(period["startTime"])
    when = _time_label(start)

    temp = _fmt_temp((period.get("temperature") or {}), period.get("temperatureUnit"), units)
    pop  = _fmt_percent((period.get("probabilityOfPrecipitation") or {}).get("value"))
    wind_dir = period.get("windDirection") or "—"
    wind_spd = period.get("windSpeed") or "—"
    short    = period.get("shortForecast") or "—"

    # Medium-style: time, short, temp, wind, precip
    return f"{when}: {short}, {temp}; wind {wind_dir} {wind_spd}; precip {pop}."


def summarize_nws_hourly(
    periods: list,
    forecast_time_iso: str,
    units: str = "F",
    fallback_to_nearest: bool = True,
    fallback_window_hours: int = 1,
    snap_to_bounds: bool = False,
) -> str:
    """
    Return a single summary for the requested ISO time using the NWS hourly endpoint.
    If forecast_time_iso == 'now' (case-insensitive), return the first period.
    """
    if not periods:
        return "No data available."

    # 'now' → first item
    if isinstance(forecast_time_iso, str) and forecast_time_iso.lower() == "now":
        return summarize_hour(periods[0], units)

    # Build index keyed by UTC-rounded start hours
    index = {}
    for p in periods:
        try:
            k = _hour_key_utc(_parse_iso(p["startTime"]))
            index[k] = p
        except Exception:
            continue

    if not index:
        return "No data available."

    keys_sorted = sorted(index.keys())

    def _nearest(target: datetime) -> datetime | None:
        best = min(keys_sorted, key=lambda k: abs(k - target))
        if abs(best - target) <= timedelta(hours=fallback_window_hours):
            return best
        return None

    # Parse request → UTC hour key
    try:
        req_key = _hour_key_utc(_parse_iso(forecast_time_iso))
    except Exception:
        return "Invalid timestamp."

    period = index.get(req_key)

    if period is None and fallback_to_nearest:
        nk = _nearest(req_key)
        if nk:
            period = index.get(nk)

    if period is None and snap_to_bounds:
        if req_key < keys_sorted[0]:
            period = index.get(keys_sorted[0])
        elif req_key > keys_sorted[-1]:
            period = index.get(keys_sorted[-1])

    return summarize_hour(period, units) if period else "No data for requested time."


# --------------------------------------
# Single-period: DAY/NIGHT (12-hour bin)
# --------------------------------------
def summarize_daynight_period(period: dict, units: str = "F") -> str:
    """Concise, single-line summary for one 12h day/night NWS period."""
    name = period.get("name") or _parse_iso(period["startTime"]).strftime("%a")

    temp = _fmt_temp((period.get("temperature") or {}), period.get("temperatureUnit"), units)
    pop  = _fmt_percent((period.get("probabilityOfPrecipitation") or {}).get("value"))
    wind_spd = period.get("windSpeed") or "—"
    wind_dir = period.get("windDirection") or "—"
    short    = period.get("shortForecast") or "—"
    hi_lo    = "high" if period.get("isDaytime") else "low"

    # Medium-style: name, short, high/low temp, wind, precip
    return f"{name}: {short}, {hi_lo} {temp}; wind {wind_dir} {wind_spd}; precip {pop}."


def summarize_nws_daily(
    periods: list,
    forecast_time_iso: str,
    units: str = "F",
) -> str:
    """
    Return a single summary for the ISO time using the NWS day/night endpoint.
    If forecast_time_iso == 'now', return the first period.
    """
    if not periods:
        return "No data available."

    # 'now' → first item
    if isinstance(forecast_time_iso, str) and forecast_time_iso.lower() == "now":
        return summarize_daynight_period(periods[0], units)

    # Pre-parse time windows
    windows = []
    for p in periods:
        try:
            start = _parse_iso(p["startTime"])
            end   = _parse_iso(p["endTime"])
            windows.append((start, end, p))
        except Exception:
            continue

    if not windows:
        return "No data available."

    try:
        t = _parse_iso(forecast_time_iso)
    except Exception:
        return "Invalid timestamp."

    target = next((p for (s, e, p) in windows if s <= t < e), None)
    return summarize_daynight_period(target, units) if target else "No data for requested time."


if __name__ == "__main__":
    # Simple test
    tool = WeatherTool()
    result = tool.call(
        location="home",
        granularity="hourly",
        forecast_times_iso="2025-11-08T18:00-05:00",
    )
    print("Result:", result)