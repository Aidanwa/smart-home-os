import os
from datetime import datetime

# Dynamically calculate local timezone for the weather tool schema
tz_env = os.getenv("TIMEZONE", "").strip()
if tz_env:
    local_timezone = tz_env
else:
    now = datetime.now().astimezone()
    tz_name = now.tzname()
    tz_offset = now.strftime("%z")
    tz_offset_formatted = f"{tz_offset[:3]}:{tz_offset[3:]}"
    local_timezone = f"{tz_name} (UTC{tz_offset_formatted})"

SMART_HOME_TOOLS = [
    {
        "name": "set_device_state",
        "description": "Changes the physical state of a smart home device (e.g., turning lights on/off, changing brightness or color).",
        "parameters": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "The exact friendly_name of the device from the context."
                },
                "state_changes": {
                    "type": "object",
                    "description": "A dictionary of the properties to change. E.g., {'state': 'ON', 'brightness': 255}",
                }
            },
            "required": ["device_id", "state_changes"]
        }
    },
    {
        "name": "update_user_profile",
        "description": "Saves long-term memory, facts, or preferences about the user. Re-write the entire memory file incorporating the new facts alongside existing ones.",
        "parameters": {
            "type": "object",
            "properties": {
                "new_content": {
                    "type": "string",
                    "description": "The complete, updated text to save in the user's profile file."
                }
            },
            "required": ["new_content"]
        }
    },
    {
        "name": "get_weather",
        "description": (
            f"Get weather information from weather.gov with control over time. "
            f"Your local timezone is {local_timezone}. "
            f"ALWAYS use your local timezone in timestamps (e.g., '2025-11-12T18:00:00-05:00'), NEVER use UTC unless explicitly requested."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "Either 'home' or 'lat,lon' (e.g., '38.9,-77.0').",
                    "default": "home"
                },
                "granularity": {
                    "type": "string",
                    "enum": ["hourly", "daily"],
                    "description": "Whether to return day/night data or hourly data. Only use hourly if specifically requested. To get night data use 11pm. To get day data, use noon",
                    "default": "daily"
                },
                "forecast_times_iso": {
                    "type": "string",
                    "description": f"ISO-8601 timestamp in LOCAL TIMEZONE {local_timezone} with offset (e.g., '2025-11-12T18:00:00-05:00'). MUST include timezone offset. NEVER use UTC (e.g., '...Z') unless explicitly requested. For current weather, use 'now'.",
                    "default": "now"
                }
            },
            "required": ["location", "forecast_times_iso", "granularity"]
        }
    }
]
