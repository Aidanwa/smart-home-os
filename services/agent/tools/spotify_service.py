# services/agent/tools/spotify_service.py
import logging
import time
import json
import asyncio
import httpx
from typing import Dict, Any, List, Optional
from sqlalchemy.future import select

# Access shared workspace persistence models natively
from shared.database.core import AsyncSessionLocal
from shared.database.models import UserSecret

logger = logging.getLogger(__name__)

class SpotifyService:
    """
    The asynchronous client responsible for communicating with the Spotify Web API
    utilizing isolated vault mapping and concurrent state safety.
    """
    def __init__(self):
        self.base = "https://api.spotify.com/v1"
        self.token_url = "https://accounts.spotify.com/api/token"
        self.client = httpx.AsyncClient(timeout=8.0, headers={
            "User-Agent": "SmartHomeAssistant/1.0"
        })
        
        # Guard concurrent multi-user refreshes and asyncio.gather splits
        self._lock = asyncio.Lock()
        
        # Per-User Token Cache: user_id -> {"access_token": str, "expires_at": float}
        self._token_cache: Dict[str, Dict[str, Any]] = {}

    async def close(self):
        """Gracefully close the HTTP connection pool."""
        await self.client.aclose()

    async def _resolve_vault_credentials(self, user_id: str) -> dict:
        """
        Queries credential configuration payloads directly out of the
        relational PostgreSQL security vault.
        """
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(UserSecret).where(
                    UserSecret.user_id == user_id, 
                    UserSecret.provider == "spotify"
                )
            )
            secret_record = result.scalar_one_or_none()
            if not secret_record:
                raise KeyError("Configuration payload missing from table context.")
            
            raw_payload = secret_record.encrypted_credentials
            return json.loads(raw_payload)

    async def _ensure_token(self, user_id: str) -> str:
        """
        Resolves access tokens utilizing double-checked locks and per-user
        in-memory TTL caches to protect against external rate limits.
        """
        now = time.time()
        
        # 1. Hotpath Check: Return cache instantly if valid (using 30-second buffer window)
        if user_id in self._token_cache:
            cache = self._token_cache[user_id]
            if now < cache["expires_at"] - 30:
                return cache["access_token"]

        # 2. Synchronize concurrent paths (e.g. from asyncio.gather loops)
        async with self._lock:
            now = time.time()
            # Double-check cache state after acquiring lock
            if user_id in self._token_cache:
                cache = self._token_cache[user_id]
                if now < cache["expires_at"] - 30:
                    return cache["access_token"]

            try:
                creds = await self._resolve_vault_credentials(user_id)
                client_id = creds.get("client_id")
                client_secret = creds.get("client_secret")
                refresh_token = creds.get("refresh_token")
            except Exception:
                raise RuntimeError(
                    "[System Observation: Spotify configuration is absent. "
                    "Prompt the user to navigate to Settings to link their account profile.]"
                )

            if not (client_id and client_secret and refresh_token):
                raise RuntimeError(
                    "[System Observation: Spotify configuration is incomplete. "
                    "Prompt the user to re-link credentials in Settings.]"
                )

            # Execute OAuth refresh token update
            response = await self.client.post(
                self.token_url,
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                auth=(client_id, client_secret)
            )
            response.raise_for_status()
            data = response.json()
            
            access_token = data["access_token"]
            expires_in = int(data.get("expires_in", 3600))
            
            # Commit item to the context cache map
            self._token_cache[user_id] = {
                "access_token": access_token,
                "expires_at": now + expires_in
            }
            
            return access_token

    async def _request(self, user_id: str, method: str, path: str, params=None, json_data=None) -> Dict[str, Any]:
        # Fetch token and build explicit local request context
        token = await self._ensure_token(user_id=user_id)
        headers = {"Authorization": f"Bearer {token}"}
        
        response = await self.client.request(
            method, f"{self.base}{path}", params=params, json=json_data, headers=headers
        )
        
        # Guard against 204 No Content or hidden whitespace payload strings
        if response.status_code == 204 or not response.text.strip():
            return {}
            
        response.raise_for_status()
        
        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            try:
                return response.json()
            except json.JSONDecodeError:
                return {"raw_value": response.text}
        else:
            return {"raw_value": response.text}

    # ---------------------------------------------------------
    # Context Builder Route
    # ---------------------------------------------------------
    async def get_spotify_context(self, user_id: str) -> str:
        """
        Fetches rich Spotify device state AND current playback context 
        to inject into the system prompt dynamically.
        """
        try:
            # Fire both network requests concurrently to save latency
            devices_task = self._request(user_id, "GET", "/me/player/devices")
            playing_task = self._request(user_id, "GET", "/me/player/currently-playing")
            
            devices_data, playing_data = await asyncio.gather(devices_task, playing_task)
            
            lines = []
            
            # 1. Parse Currently Playing
            if playing_data and playing_data.get("is_playing") and playing_data.get("item"):
                item = playing_data["item"]
                track_name = item.get("name", "Unknown Track")
                artists = ", ".join([a.get("name", "Unknown") for a in item.get("artists", [])])
                lines.append(f"[NOW PLAYING]: '{track_name}' by {artists}")
            else:
                lines.append("[NOW PLAYING]: Nothing is currently playing.")
                
            # 2. Parse Devices
            devices = devices_data.get("devices", [])
            if not devices:
                lines.append("Known Spotify devices: none detected.")
            else:
                lines.append("\nKnown Spotify devices:")
                for d in devices:
                    name = (d.get("name") or "").strip()
                    dev_id = (d.get("id") or "").strip()
                    dev_type = d.get("type", "unknown").lower()
                    volume = d.get("volume_percent", "unknown")
                    active_flag = " [ACTIVE PLAYBACK]" if d.get("is_active") else ""
                    
                    if name and dev_id:
                        lines.append(f"- {name} ({dev_type}){active_flag} | Vol: {volume}% | id: {dev_id}")
            
            return "\n".join(lines)
            
        except Exception as e:
            # Safely catch system configuration exceptions to bypass prompt loop failures
            if "[System Observation:" in str(e):
                return str(e)
            logger.error(f"Failed to fetch Spotify context: {e}")
            return "[SPOTIFY]: API Error or Not Authenticated."

    # ---------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------
    async def _resolve_device_id(self, user_id: str, device_or_id: Optional[str]) -> Optional[str]:
        if not device_or_id:
            return None
        if len(device_or_id) > 10 and " " not in device_or_id:
            return device_or_id
            
        data = await self._request(user_id, "GET", "/me/player/devices")
        devices = data.get("devices", [])
        
        for d in devices:
            if device_or_id.lower() in (d.get("name") or "").lower():
                return d.get("id")
        return None

    async def _search_one(self, user_id: str, q: str, typ: str, market: str = "US") -> Optional[Dict]:
        data = await self._request(user_id, "GET", "/search", params={"q": q, "type": typ, "limit": 1, "market": market})
        bucket = data.get(f"{typ}s", {}).get("items", [])
        return bucket[0] if bucket else None

    # ---------------------------------------------------------
    # LLM Tool Executions (Names must match schema!)
    # ---------------------------------------------------------
    async def spotify_play(self, user_id: str, market="US", device=None, position_ms=0, query_type="track", query=None, context_uri=None, uris=None, **kwargs) -> Dict[str, Any]:
        """Tool: Start/resume playback."""
        try:
            device_id = await self._resolve_device_id(user_id, device)
            if not uris and not context_uri and query:
                item = await self._search_one(user_id, query, query_type, market)
                if not item:
                    return {"status": "error", "message": "No search results found."}
                if query_type == "track":
                    uris = [item["uri"]]
                else:
                    context_uri = item["uri"]
                    
            body = {}
            if uris: body["uris"] = uris
            if context_uri: body["context_uri"] = context_uri
            if position_ms: body["position_ms"] = int(position_ms)

            await self._request(
                user_id, "PUT", "/me/player/play", 
                params={"device_id": device_id} if device_id else None, 
                json_data=body or None
            )
            return {"status": "success", "message": "Playback started."}
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"Spotify API rejected command: {e.response.text}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def spotify_controller(self, user_id: str, command: str, device: str = None, shuffle_state: bool = True, repeat_mode: str = "context", volume_percent: int = None, force_play: bool = True, **kwargs) -> Dict[str, Any]:
        """Tool: Unified transport, volume, and device controller for Spotify."""
        try:
            device_id = await self._resolve_device_id(user_id, device)
            params = {"device_id": device_id} if device_id else {}
            
            command = command.lower()
            
            if command == "pause":
                await self._request(user_id, "PUT", "/me/player/pause", params=params)
                message = "Playback paused."
                
            elif command == "next":
                await self._request(user_id, "POST", "/me/player/next", params=params)
                message = "Skipped to next track."
                
            elif command == "previous":
                await self._request(user_id, "POST", "/me/player/previous", params=params)
                message = "Skipped to previous track."
                
            elif command == "shuffle":
                params["state"] = "true" if shuffle_state else "false"
                await self._request(user_id, "PUT", "/me/player/shuffle", params=params)
                message = f"Shuffle turned {'on' if shuffle_state else 'off'}."
                
            elif command == "repeat":
                if repeat_mode not in ["track", "context", "off"]:
                    repeat_mode = "context"
                params["state"] = repeat_mode
                await self._request(user_id, "PUT", "/me/player/repeat", params=params)
                message = f"Repeat mode set to {repeat_mode}."
                
            elif command == "volume":
                if volume_percent is None:
                    return {"status": "error", "message": "volume_percent is required for volume command."}
                percent = max(0, min(100, int(volume_percent)))
                params["volume_percent"] = percent
                await self._request(user_id, "PUT", "/me/player/volume", params=params)
                message = f"Volume set to {percent}%."
                
            elif command == "transfer":
                if not device_id:
                    return {"status": "error", "message": f"Device '{device}' not found. Please provide a valid device to transfer to."}
                await self._request(user_id, "PUT", "/me/player", json_data={"device_ids": [device_id], "play": force_play})
                message = f"Playback transferred to selected device."
                
            else:
                return {"status": "error", "message": f"Unknown command: {command}"}

            return {"status": "success", "message": message}
            
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"Spotify API rejected controller command: {e.response.text}"}
        except Exception as e:
            return {"status": "error", "message": f"Spotify controller failed: {str(e)}"}

    async def spotify_get_advanced_info(self, user_id: str, **kwargs) -> Dict[str, Any]:
        """Tool: Get a detailed overview of what's currently happening, including recently played tracks."""
        try:
            state_task = self._request(user_id, "GET", "/me/player")
            queue_task = self._request(user_id, "GET", "/me/player/queue")
            
            state_data, queue_data = await asyncio.gather(state_task, queue_task)
            
            state_data = state_data or {}
            queue_data = queue_data or {}
            
            response = {
                "shuffle_state": state_data.get("shuffle_state", False),
                "repeat_state": state_data.get("repeat_state", "off"),
                "progress_ms": state_data.get("progress_ms", 0),
                "is_playing": state_data.get("is_playing", False),
                "active_device": state_data.get("device", {}).get("name", "Unknown"),
            }
            
            upcoming = queue_data.get("queue", [])[:5]
            response["upcoming_queue"] = [
                f"{t.get('name')} by {t.get('artists', [{}])[0].get('name', 'Unknown')}" 
                for t in upcoming if t.get("type") == "track"
            ]
            
            return {"status": "success", "data": response}
        except Exception as e:
            return {"status": "error", "message": f"Failed to get advanced info: {str(e)}"}

    async def spotify_search(self, user_id: str, query: str, types: list = None, limit: int = 3, market: str = "US", **kwargs) -> Dict[str, Any]:
        """Tool: Search Spotify catalog and return condensed, token-efficient results."""
        if not types:
            types = ["track"]
            
        limit = min(5, max(1, int(limit))) 
        type_str = ",".join(types)
        
        try:
            data = await self._request(user_id, "GET", "/search", params={
                "q": query,
                "type": type_str,
                "limit": limit,
                "market": market
            })
            
            results = {}
            if "tracks" in data:
                results["tracks"] = [
                    {"name": t.get("name"), "artists": [a.get("name") for a in t.get("artists", [])], "uri": t.get("uri")}
                    for t in data["tracks"].get("items", []) if t is not None
                ]
            if "albums" in data:
                results["albums"] = [
                    {"name": a.get("name"), "artists": [art.get("name") for art in a.get("artists", [])], "uri": a.get("uri"), "release_date": a.get("release_date")}
                    for a in data["albums"].get("items", []) if a is not None
                ]
            if "artists" in data:
                results["artists"] = [
                    {"name": art.get("name"), "uri": art.get("uri"), "genres": art.get("genres", [])[:3]}
                    for art in data["artists"].get("items", []) if art is not None
                ]
            if "playlists" in data:
                results["playlists"] = [
                    {"name": p.get("name"), "owner": p.get("owner", {}).get("display_name", "Unknown"), "uri": p.get("uri")}
                    for p in data["playlists"].get("items", []) if p is not None
                ]

            return {"status": "success", "data": results}
            
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"Spotify API rejected search: {e.response.text}"}
        except Exception as e:
            return {"status": "error", "message": f"Search failed: {str(e)}"}