import logging
import json
from typing import Callable, List, Dict, Any, AsyncGenerator, Tuple
from core.memory import MemoryManager
from tools.weather_service import WeatherService
from tools.gateway_api import GatewayClient
from tools.spotify_service import SpotifyService
from providers.base import BaseLLMProvider
from datetime import datetime, timedelta
from tools.schema import get_agent_tools
from zoneinfo import ZoneInfo
from shared.database.core import get_db
from sqlalchemy.future import select
from shared.database.models import Home

logger = logging.getLogger(__name__)

class SmartHomeOrchestrator:
    def __init__(
        self,
        llm_provider: BaseLLMProvider,       
        gateway_client: GatewayClient,
        weather_service: WeatherService,    
        memory_manager: MemoryManager,
        spotify_service: SpotifyService,
        system_prompt_tmpl: str, 
        tool_map: Dict[str, Callable],
    ):
        self.llm = llm_provider
        self.gateway = gateway_client
        self.memory = memory_manager
        self.weather = weather_service
        self.spotify = spotify_service
        self.system_prompt_tmpl = system_prompt_tmpl
        self.tools_schema = []
        self.tool_map = tool_map
        self.max_iterations = 5
        
        # --- System-Level Caches ---
        self._system_weather_cache: str | None = None
        self._weather_last_fetched: datetime | None = None
        self._weather_cache_ttl = timedelta(hours=1)

    async def _build_system_prompt(
        self, 
        user_id: str, 
        cached_weather: str | None = None, 
        cached_spotify: str | None = None
    ) -> Tuple[str, str, str]:
        
        home_context = await self.gateway.get_filtered_context(user_id)

        # 1. Fetch Home Profile for Timezone and Nickname
        tz_name = "UTC"
        
        # Fast local DB fetch
        async for session in get_db():
            home = await session.scalar(select(Home).limit(1))
            if home:
                home_nickname = home.nickname
                tz_name = home.timezone
            else:
                home_nickname = "User has not configured their home profile. They can do this in Settings → Home Settings."
            break

        # 2. Calculate accurate local time based on Home timezone
        try:
            now = datetime.now(ZoneInfo(tz_name))
        except Exception as e:
            logger.warning(f"Invalid timezone '{tz_name}', falling back to system local: {e}")
            now = datetime.now().astimezone()
        
        if cached_weather is None:
            if (self._system_weather_cache is None or 
                self._weather_last_fetched is None or 
                (now - self._weather_last_fetched) > self._weather_cache_ttl):
                
                weather_response = await self.weather.get_weather(
                    user_id=user_id, granularity="hourly", forecast_times_iso="now", location="home"
                )
                if weather_response.get("status") == "success":
                    self._system_weather_cache = weather_response["data"]
                else:
                    self._system_weather_cache = "Current weather unavailable."
                self._weather_last_fetched = now
            current_weather = self._system_weather_cache
        else:
            current_weather = cached_weather
            
        # Inject user_id to read specific user relational tokens
        if cached_spotify is None:
            current_spotify = await self.spotify.get_spotify_context(user_id=user_id)
            logger.debug(f"Fetched vault-resolved Spotify context for user: {user_id}")
        else:
            current_spotify = cached_spotify

        user_profile = await self.memory.get_user_profile(user_id)
        time_str = now.strftime('%A, %B %d, %Y at %I:%M %p %Z')
        
        # Build Instructions
        instructions = self.system_prompt_tmpl.format(
            homename=home_nickname,
            homestate=home_context,
            userprofile=user_profile,
            weatherinfo=current_weather,
            spotifyinfo=current_spotify,
            timeinfo=time_str,
        )
        
        return instructions, current_weather, current_spotify

    async def process_intent_stream(self, user_id: str, user_text: str) -> AsyncGenerator[Dict[str, Any], None]:
        # 1. First Run: Pass None for caches to force a full fetch of all contexts
        instructions, cached_weather, cached_spotify = await self._build_system_prompt(
            user_id=user_id, 
            cached_weather=None, 
            cached_spotify=None
        )

        # Conditionally build the tools schema based on the user's ID
        self.tools_schema = get_agent_tools(has_spotify=await self.spotify.check_credentials(user_id))
        logger.debug(f"Tools schema for user {user_id}: {[tool['name'] for tool in self.tools_schema]}")
        # 2. Retrieve Pruned History
        history = self.memory.get_history(user_id)
        
        # Start message array with System, then History, then the New Query
        current_messages = [{"role": "system", "content": instructions}]
        current_messages.extend(history)
        
        new_msg = {"role": "user", "content": user_text}
        current_messages.append(new_msg)
        self.memory.add_message(user_id, new_msg)

        # The Agentic Loop
        for iteration in range(self.max_iterations):
            logger.debug(f"Streaming Loop {iteration + 1}/{self.max_iterations}")

            stream = self.llm.generate_stream(
                messages=current_messages,
                tools=self.tools_schema
            )

            accumulated_text = ""

            async for chunk in stream:
                if chunk["type"] == "text_chunk":
                    accumulated_text += chunk["content"]
                    yield chunk
                
                elif chunk["type"] == "error":
                    yield {"type": "text_chunk", "content": f"\n[Error: {chunk['content']}]"}
                    return

                elif chunk["type"] == "done":
                    if accumulated_text:
                        assistant_msg = {"role": "assistant", "content": accumulated_text}
                        current_messages.append(assistant_msg)
                        self.memory.add_message(user_id, assistant_msg)
                        
                        logger.info(f"SYSTEM PROMPT:\n{current_messages[0]['content']}\n")
                        self.memory.pretty_print_history(user_id)
                    return
                
                elif chunk["type"] == "tool_calls":
                    tool_calls = chunk.get("message", [])
                    
                    current_messages.extend(tool_calls)
                    for msg in tool_calls:
                        self.memory.add_message(user_id, msg)
                        
                        yield {
                            "type": "tool_call", 
                            "name": msg.get("name", "Unknown Tool"), 
                            "arguments": msg.get("arguments", "{}"),
                            "status": "pending"
                        }

                    # Execute Tools
                    tool_results = await self._execute_tool_calls(user_id, tool_calls)
                    
                    current_messages.extend(tool_results)
                    for tr in tool_results:
                        self.memory.add_message(user_id, tr)

                    for msg in tool_calls:
                        yield {
                            "type": "tool_call", 
                            "name": msg.get("name", "Unknown Tool"), 
                            "arguments": msg.get("arguments", "{}"),
                            "status": "completed"
                        }
                    
                    # -> THE INVALIDATION ENGINE <-
                    # Check what domains the tools actually interacted with
                    touched_spotify = any("spotify" in call.get("name", "") for call in tool_calls)
                    
                    # Rebuild the prompt. 
                    # If Spotify was touched, pass None to force a refetch. Otherwise pass the cache.
                    # Weather is always passed as cache because tools don't change the weather.
                    new_instructions, cached_weather, cached_spotify = await self._build_system_prompt(
                        user_id=user_id,
                        cached_weather=cached_weather,
                        cached_spotify=None if touched_spotify else cached_spotify
                    )
                    
                    # Update the system prompt right before we restart the LLM generation
                    current_messages[0]["content"] = new_instructions
                    
                    break 

        yield {"type": "text_chunk", "content": "\n[System: Max reasoning steps reached.]"}


    async def _execute_tool_calls(self, user_id: str, tool_calls: List[Dict]) -> List[Dict]:
        results = []
        for call in tool_calls:
            tool_id = call.get("id")
            tool_name = call.get("name")
            try:
                args = json.loads(call.get("arguments", "{}"))
                tool_method = self.tool_map.get(tool_name)
                
                if not tool_method:
                    raise AttributeError(f"Tool '{tool_name}' is not registered.")
                
                result_data = await tool_method(user_id=user_id, **args)
            
            except Exception as e:
                result_data = {"error": str(e)}

            results.append({
                "type": "function_call_output",
                "call_id": tool_id,
                "output": json.dumps(result_data)
            })
            
        return results