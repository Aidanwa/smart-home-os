from typing import List, Dict, Any

def get_agent_tools(has_spotify: bool = False) -> List[Dict[str, Any]]:
    """
    Returns the dynamic list of tools available to the LLM agent.
    Conditionally injects Spotify tools if the user has linked their account.
    """
    # Base Tools (Always available)
    tools = [
        {
            "name": "set_device_state",
            "description": "Changes the physical state of one or multiple smart home devices simultaneously. Can apply different states to different devices in a single call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "commands": {
                        "type": "array",
                        "description": "A list of device state changes to apply.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "device": {
                                    "type": "string",
                                    "description": "The exact friendly_name of the device from the context."
                                },
                                "state": {
                                    "type": "object",
                                    "description": "A dictionary of the properties to change. E.g., {'state': 'ON', 'brightness': 254}"
                                }
                            },
                            "required": ["device", "state"]
                        }
                    }
                },
                "required": ["commands"]
            }
        },
        {
            "name": "update_memory",
            "description": "Applies targeted diff operations to the user's long-term memory array. Allows adding new facts, updating inaccurate facts, or removing stale facts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "operations": {
                        "type": "array",
                        "description": "A list of targeted updates to apply to the user's long-term profile.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {
                                    "type": "string",
                                    "enum": ["add", "update", "remove"],
                                    "description": "The type of operation to perform: 'add', 'update', or 'remove'."
                                },
                                "fact_id": {
                                    "type": ["integer", "null"],
                                    "description": "The index/ID of the fact being modified or removed. Leave null when adding a new fact."
                                },
                                "content": {
                                    "type": ["string", "null"],
                                    "description": "The textual content of the preference or fact. Leave null when removing."
                                }
                            },
                            "required": ["op"]
                        }
                    }
                },
                "required": ["operations"]
            }
        },
        {
            "name": "get_weather",
            "description": "Get weather information from weather.gov with control over time. ALWAYS use your local timezone in timestamps, NEVER use UTC unless explicitly requested.",
            "parameters": {
                "type": "object",
                "properties": {
                    "loc": {
                        "type": "string",
                        "description": "Either 'home' or 'lat,lon' (e.g., '38.9,-77.0').",
                        "default": "home"
                    },
                    "type": {
                        "type": "string",
                        "enum": ["hourly", "daily"],
                        "description": "Whether to return day/night data or hourly data. To get night data use 11pm. To get day data, use noon.",
                        "default": "daily"
                    },
                    "time": {
                        "type": "string",
                        "description": f"ISO-8601 timestamp in local timezone with offset (e.g., '2025-11-12T18:00:00-05:00'). MUST include timezone offset. For current weather, use 'now'.",
                        "default": "now"
                    }
                },
                "required": ["loc", "time", "type"]
            }
        }
    ]

    # Routine tools (always available). Short names save tokens; the format lives in rt_format.
    NO_ARGS = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
    tools.extend([
        {
            "name": "rt_format",
            "description": "Get the JSON format for routines (schedules/automations). Call this before rt_save.",
            "parameters": NO_ARGS,
        },
        {
            "name": "rt_list",
            "description": "List the household's routines with ids, next run, last result and full definitions. Use before editing, enabling, running or deleting one.",
            "parameters": NO_ARGS,
        },
        {
            "name": "rt_save",
            "description": "Create a routine (id null) or update one (id from rt_list; send only the fields that change, e.g. just triggers). Use device/group names. After saving, read back what it does in one short sentence.",
            "parameters": {
                "type": "object",
                "properties": {
                    "routine": {"type": "string", "description": "The routine as a JSON object string (see rt_format)."},
                    "id": {"type": ["string", "null"], "description": "Routine id to replace, or null to create."},
                },
                "required": ["routine", "id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "rt_enable",
            "description": "Turn a routine on or off (e.g. 'skip the wake-up routine').",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "enabled": {"type": "boolean"}},
                "required": ["id", "enabled"],
                "additionalProperties": False,
            },
        },
        {
            "name": "rt_run",
            "description": "Run a routine now.",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "rt_delete",
            "description": "Delete a routine. Call with confirmed=false first, ask the user, and only call again with confirmed=true after they say yes.",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "confirmed": {"type": "boolean"}},
                "required": ["id", "confirmed"],
                "additionalProperties": False,
            },
        },
    ])

    # Conditionally inject Spotify tools
    if has_spotify:
        spotify_tools = [
            {
                "name": "spot_play",
                "description": "Start playback of specific music on a device. Give track URIs in 'uris', OR an album/playlist/artist URI in 'ctx', OR a search 'q'. Set every unused field to null. Don't call repeatedly: if it returns an error saying playback didn't start, tell the user instead of retrying.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dev": {
                            "type": "string",
                            "description": "Device name substring or device_id."
                        },
                        "uris": {
                            "type": ["array", "null"],
                            "items": {"type": "string"},
                            "description": "Track URIs only ('spotify:track:...'). Never artist/album/playlist URIs. Null if using ctx or q."
                        },
                        "ctx": {
                            "type": ["string", "null"],
                            "description": "One album/playlist/artist URI ('spotify:album:...'). Never a track URI. Null if using uris or q."
                        },
                        "q": {
                            "type": ["string", "null"],
                            "description": "Search query to play the top result (e.g. 'lofi beats'). Null if uris or ctx is given."
                        },
                        "q_type": {
                            "type": ["string", "null"],
                            "enum": ["track", "album", "playlist", "artist", None],
                            "description": "Result type for q. Null if q is null."
                        },
                        "pos": {
                            "type": ["integer", "null"],
                            "description": "Start position in ms. Null to start from the beginning."
                        }
                    },
                    "required": ["dev", "uris", "ctx", "q", "q_type", "pos"],
                    "additionalProperties": False
                }
            },
            {
                "name": "spot_ctrl",
                "description": "Unified transport, device, and volume controls: resume, pause, skip, shuffle, repeat, volume, or transfer playback to another speaker. Use 'resume' (not 'next') when the user just says play/continue/unpause. Set every field the chosen cmd doesn't use to null.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {
                            "type": "string",
                            "enum": ["resume", "pause", "next", "previous", "shuffle", "repeat", "volume", "transfer"],
                            "description": "The control action to execute."
                        },
                        "dev": {
                            "type": ["string", "null"],
                            "description": "Device name substring or device_id. Required for 'transfer'; otherwise null to act on the active device."
                        },
                        "shuf": {
                            "type": ["boolean", "null"],
                            "description": "Only for cmd='shuffle': true = on, false = off. Otherwise null."
                        },
                        "rep": {
                            "type": ["string", "null"],
                            "enum": ["track", "context", "off", None],
                            "description": "Only for cmd='repeat': 'track' repeats the song, 'context' the album/playlist, 'off'. Otherwise null."
                        },
                        "vol": {
                            "type": ["integer", "null"],
                            "description": "Only for cmd='volume': target volume 0-100. Otherwise null."
                        },
                        "play": {
                            "type": ["boolean", "null"],
                            "description": "Only for cmd='transfer': true to start playing on the new device, false to keep it paused. Otherwise null."
                        }
                    },
                    "required": ["cmd", "dev", "shuf", "rep", "vol", "play"],
                    "additionalProperties": False
                }
            },
            {
                "name": "spot_info",
                "description": "Get highly detailed playback state, including exact track progress, shuffle/repeat status, and the upcoming track queue.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "spot_search",
                "description": "Search for tracks, albums, artists, or playlists.\nADVANCED SYNTAX:\n- Use 'field:value' pairs for precision (e.g., 'artist:Daft Punk', 'track:One More Time').\n- Date ranges: 'year:1990-2000'.\n- Genre: 'genre:electronic'.\nAlways use this to retrieve the specific 'uri' before passing it to 'spot_play'.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "q": {
                            "type": "string", 
                            "description": "The search term, including optional field filters like 'artist:', 'track:', 'year:', or 'genre:'."
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
                    "required": ["q"]
                }
            },
            {
                "name": "spot_queue",
                "description": "Add a specific track, album, or playlist to the user's upcoming playback queue. Does NOT interrupt the currently playing music. Requires a valid Spotify URI.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "uri": {
                            "type": "string", 
                            "description": "The exact Spotify URI of the item to queue (e.g., 'spotify:track:123456...')."
                        }
                    },
                    "required": ["uri"]
                }
            },
            {
                "name": "spot_search_playlist",
                "description": "Search the user's saved Spotify playlists by name to get the exact 'uri' to play. ALWAYS use this before playing a user's playlist. "
                "This method does substring matching, token intersection, and fuzz similarity on the query term to find results. It returns the top 5 or less closest matches."
                "This is the only way to find playlists that are private to the user. "
                "Prioritize searching with this tool when the user requests a playlist. only use lowercase, normalizes all names to lowercase.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string", 
                            "description": "The name of the playlist to search for (e.g., 'Chill Vibes'). This is a fuzzy match and will return the top 5 most similar playlists"
                        },
                        "force_reload": {
                            "type": "boolean",
                            "description": "Set to True ONLY if the user explicitly mentions they just created or saved a new playlist today, or you can't find a playlist they say they have. Otherwise, it will default to False."
                        }
                    },
                    "required": ["query"]
                }
            },
        ]
        tools.extend(spotify_tools)

    return tools