import os
from datetime import datetime
from typing import List, Dict, Any

def get_agent_tools(has_spotify: bool = False) -> List[Dict[str, Any]]:
    """
    Returns the dynamic list of tools available to the LLM agent.
    Conditionally injects Spotify tools if the user has linked their account.
    """
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

    # Base Tools (Always available)
    tools = [
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

    # Conditionally inject Spotify tools
    if has_spotify:
        spotify_tools = [
            {
                "name": "spotify_play",
                "description": "Start/resume playback. Provide a URI/context_uri or a simple search query. You must provide a device.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "uris": {
                            "type": ["array", "null"],
                            "items": {"type": "string"},
                            "description": "List of track URIs to play (e.g., 'spotify:track:...')."
                        },
                        "context_uri": {
                            "type": ["string", "null"],
                            "description": "Album/playlist/artist URI to play (e.g., 'spotify:album:...')."
                        },
                        "query": {
                            "type": ["string", "null"],
                            "description": "Fallback search query if no URIs provided (e.g., 'lofi beats')."
                        },
                        "query_type": {
                            "type": "string",
                            "enum": ["track", "album", "playlist", "artist"],
                            "description": "Type for search-based playback."
                        },
                        "device": {
                            "type": "string",
                            "description": "Device name substring or device_id."
                        },
                        "position_ms": {
                            "type": "integer",
                            "description": "Start position in ms."
                        },
                        "market": {
                            "type": ["string", "null"],
                            "description": "Market for search."
                        }
                    },
                    "required": ["market", "device", "position_ms", "query_type", "query", "context_uri", "uris"]
                }
            },
            {
                "name": "spotify_controller",
                "description": "Unified transport, device, and volume controls. Use this to pause, skip tracks, toggle shuffle, change volume, or transfer playback to a new speaker.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "enum": ["pause", "next", "previous", "shuffle", "repeat", "volume", "transfer"],
                            "description": "The control action to execute."
                        },
                        "device": {
                            "type": "string",
                            "description": "Device name substring or device_id. Required if command is 'transfer', optional for others."
                        },
                        "shuffle_state": {
                            "type": "boolean",
                            "description": "Required if command is 'shuffle'. True to turn on, false to turn off."
                        },
                        "repeat_mode": {
                            "type": "string",
                            "enum": ["track", "context", "off"],
                            "description": "Required if command is 'repeat'. 'track' repeats song, 'context' repeats album/playlist."
                        },
                        "volume_percent": {
                            "type": "integer",
                            "description": "Required if command is 'volume'. Target volume from 0-100."
                        },
                        "force_play": {
                            "type": "boolean",
                            "description": "Used if command is 'transfer'. True to start playing on the new device immediately. Default is true."
                        }
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "spotify_get_advanced_info",
                "description": "Get highly detailed playback state, including exact track progress, shuffle/repeat status, and the upcoming track queue.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "spotify_search",
                "description": "Search for tracks, albums, artists, or playlists. \n\nADVANCED SEARCH SYNTAX:\n- Use 'field:value' pairs for precision (e.g., 'artist:Daft Punk', 'track:One More Time').\n- Date ranges: 'year:1990-2000'.\n- Genre: 'genre:electronic'.\n- Niche discovery: 'tag:hipster' (obscure) or 'tag:new' (last 2 weeks) - applies to albums.\n\nEXAMPLES:\n- 'track:Get Lucky artist:Daft Punk'\n- 'album:Discovery year:2001'\n- 'genre:jazz year:1950-1960'\n\nAlways use this to retrieve the specific 'uri' before passing it to 'spotify_play'.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search term, including optional field filters like 'artist:', 'track:', 'year:', 'genre:', or 'tag:'."
                        },
                        "types": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ["track", "album", "artist", "playlist"]
                            },
                            "description": "Types of results to search for. Default is ['track']."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Number of results per type (max 5). Default is 3."
                        }
                    },
                    "required": ["query"]
                }
            }
        ]
        tools.extend(spotify_tools)

    return tools