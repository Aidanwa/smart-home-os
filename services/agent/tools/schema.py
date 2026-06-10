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
                                    "description": "A dictionary of the properties to change. E.g., {'state': 'ON', 'brightness': 255}"
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
            "description": "Saves long-term memory, facts, or preferences about the user. Re-write the entire memory file incorporating the new facts alongside existing ones. Keep the text concise. Do not delete old information unless intentional.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The complete, updated text to save in the user's profile file."
                    }
                },
                "required": ["text"]
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

    # Conditionally inject Spotify tools
    if has_spotify:
        spotify_tools = [
            {
                "name": "spot_play",
                "description": "Start/resume playback. Provide a URI/context_uri or a simple search query. You must provide a device.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dev": {
                            "type": "string", 
                            "description": "Device name substring or device_id."
                        },
                        "uris": {
                            "type": "array", 
                            "items": {"type": "string"},
                            "description": "List of track URIs to play (e.g., 'spotify:track:...')."
                        },
                        "ctx": {
                            "type": "string", 
                            "description": "Album/playlist/artist URI to play (e.g., 'spotify:album:...')."
                        },
                        "q": {
                            "type": "string", 
                            "description": "Fallback search query if no URIs provided (e.g., 'lofi beats')."
                        },
                        "q_type": {
                            "type": "string", 
                            "enum": ["track", "album", "playlist", "artist"],
                            "description": "Type for search-based playback."
                        },
                        "pos": {
                            "type": "integer", 
                            "description": "Start position in ms."
                        }
                    },
                    "required": ["dev"] 
                }
            },
            {
                "name": "spot_ctrl",
                "description": "Unified transport, device, and volume controls. Use this to pause, skip tracks, toggle shuffle, change volume, or transfer playback to a new speaker.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {
                            "type": "string",
                            "enum": ["pause", "next", "previous", "shuffle", "repeat", "volume", "transfer"],
                            "description": "The control action to execute."
                        },
                        "dev": {
                            "type": "string", 
                            "description": "Device name substring or device_id. Required if command is 'transfer'."
                        },
                        "shuf": {
                            "type": "boolean",
                            "description": "Required if command is 'shuffle'. True to turn on, false to turn off."
                        },
                        "rep": {
                            "type": "string", 
                            "enum": ["track", "context", "off"],
                            "description": "Required if command is 'repeat'. 'track' repeats song, 'context' repeats album/playlist."
                        },
                        "vol": {
                            "type": "integer", 
                            "description": "Required if command is 'volume'. Target volume from 0-100."
                        },
                        "play": {
                            "type": "boolean", 
                            "description": "Used if command is 'transfer'. True to start playing on the new device immediately. Default is true."
                        }
                    },
                    "required": ["cmd"]
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