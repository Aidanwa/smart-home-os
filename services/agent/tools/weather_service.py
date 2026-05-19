# src/tools/weather_service.py
import os
import asyncio
import logging
import httpx
from typing import Any, Dict, Tuple, Optional
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)

def _hour_key_utc(dt: datetime) -> datetime:
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
    try:
        return dt.strftime("%a %-I %p %Z")
    except ValueError:
        return dt.strftime("%a %#I %p %Z")

def summarize_hour(period: dict, units: str = "F") -> str:
    start = _parse_iso(period["startTime"])
    when = _time_label(start)
    temp = _fmt_temp((period.get("temperature") or {}), period.get("temperatureUnit"), units)
    pop  = _fmt_percent((period.get("probabilityOfPrecipitation") or {}).get("value"))
    wind_dir = period.get("windDirection") or "—"
    wind_spd = period.get("windSpeed") or "—"
    short    = period.get("shortForecast") or "—"
    return f"{when}: {short}, {temp}; wind {wind_dir} {wind_spd}; precip {pop}."

def summarize_nws_hourly(
    periods: list, forecast_time_iso: str, units: str = "F", 
    fallback_to_nearest: bool = True, fallback_window_hours: int = 1, snap_to_bounds: bool = False
) -> str:
    if not periods:
        return "No data available."
    if isinstance(forecast_time_iso, str) and forecast_time_iso.lower() == "now":
        return summarize_hour(periods[0], units)

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

def summarize_daynight_period(period: dict, units: str = "F") -> str:
    name = period.get("name") or _parse_iso(period["startTime"]).strftime("%a")
    temp = _fmt_temp((period.get("temperature") or {}), period.get("temperatureUnit"), units)
    pop  = _fmt_percent((period.get("probabilityOfPrecipitation") or {}).get("value"))
    wind_spd = period.get("windSpeed") or "—"
    wind_dir = period.get("windDirection") or "—"
    short    = period.get("shortForecast") or "—"
    hi_lo    = "high" if period.get("isDaytime") else "low"
    return f"{name}: {short}, {hi_lo} {temp}; wind {wind_dir} {wind_spd}; precip {pop}."

def summarize_nws_daily(periods: list, forecast_time_iso: str, units: str = "F") -> str:
    if not periods:
        return "No data available."
    if isinstance(forecast_time_iso, str) and forecast_time_iso.lower() == "now":
        return summarize_daynight_period(periods[0], units)

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

# ----- Weather Service Class -----

class WeatherService:
    """
    HTTP client responsible for fetching data from the National Weather Service.
    Ported to the new Async Framework.
    """
    def __init__(self):
        self.base_url = "https://api.weather.gov"
        self.timeout = 8.0
        self.user_agent = os.getenv(
            "WEATHER_USER_AGENT",
            "SmartHomeAssistant/1.0 (contact: you@example.com)"
        )
        self.home_grid = os.getenv("HOME_GRID", "").strip()
        
        # AsyncClient initialization
        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "application/ld+json, application/json"
            }
        )

    async def close(self):
        """Gracefully close the HTTP connection pool."""
        await self.client.aclose()

    async def _get_json(self, url: str) -> Dict[str, Any]:
        """Async fetch with simple retry logic."""
        last_err = None
        for i in range(3):
            try:
                response = await self.client.get(url)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.debug(f"Weather API request retry {i+1}/3", extra={"url": url, "error": str(e)})
                last_err = e
                await asyncio.sleep(0.25 * (i + 1))
        raise Exception(f"Failed after 3 retries. Last error: {last_err}")

    def _resolve_location(self, location: str) -> Tuple[Optional[float], Optional[float], Optional[Tuple[str, int, int]]]:
        if location.lower() == "home":
            if self.home_grid and self.home_grid.count(",") == 2:
                grid_id, x_s, y_s = [p.strip() for p in self.home_grid.split(",")]
                return None, None, (grid_id, int(x_s), int(y_s))
            raise ValueError("Home location not configured correctly (set HOME_GRID env var).")
        if "," in location:
            lat_s, lon_s = location.split(",", 1)
            return float(lat_s.strip()), float(lon_s.strip()), None
        raise ValueError("Provide 'home' or explicit 'lat,lon' (geocoding not enabled).")

    async def _points(self, lat: float, lon: float) -> Dict[str, Any]:
        url = f"{self.base_url}/points/{lat:.4f},{lon:.4f}"
        return await self._get_json(url)

    # ---------------------------------------------------------
    # LLM Tool Execution
    # ---------------------------------------------------------
    # The name of this method matches the tool name provided in the schema!
    
    async def get_weather(
        self, 
        user_id: str, # unused but important for structure of tool methods, maybe can be improved
        granularity: str = "daily", 
        forecast_times_iso: str = "now", 
        location: str = "home"
    ) -> Dict[str, Any]:
        """
        Tool: Get weather information from weather.gov.
        """
        try:
            # Validate timestamp format
            if forecast_times_iso.lower() != "now":
                if not ('+' in forecast_times_iso or '-' in forecast_times_iso.split('T')[-1] or forecast_times_iso.endswith('Z')):
                    try:
                        dt_naive = datetime.fromisoformat(forecast_times_iso)
                        local_tz = datetime.now().astimezone().tzinfo
                        dt_aware = dt_naive.replace(tzinfo=local_tz)
                        forecast_times_iso = dt_aware.isoformat()
                        logger.warning(f"Timestamp was missing timezone, added local timezone: {forecast_times_iso}")
                    except Exception as e:
                        return {"status": "error", "message": f"Timestamp must include timezone offset. Got: '{forecast_times_iso}'"}

            lat, lon, grid = self._resolve_location(location)
            
            # Build forecast URLs
            if grid:
                grid_id, grid_x, grid_y = grid
                forecast_url = f"{self.base_url}/gridpoints/{grid_id}/{grid_x},{grid_y}/forecast"
                hourly_url = f"{forecast_url}/hourly"
            else:
                points = await self._points(lat, lon)
                forecast_url = points["forecast"]
                hourly_url = points["forecastHourly"]

            # Fetch and summarize
            if granularity == "hourly":
                hourly = await self._get_json(hourly_url)
                summary_str = summarize_nws_hourly(hourly["periods"], forecast_times_iso, units="F")
            else:  # "daily" (default)
                daily = await self._get_json(forecast_url)
                summary_str = summarize_nws_daily(daily["periods"], forecast_times_iso, units="F")

            logger.info(f"Weather forecast retrieved for {location}")
            return {"status": "success", "data": summary_str}

        except Exception as e:
            logger.error(f"WeatherTool error: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}