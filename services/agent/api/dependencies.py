# src/api/dependencies.py
import os
from core.orchestrator import SmartHomeOrchestrator
from providers.openai import OpenAIProvider
from shared.database.core import AsyncSessionLocal
from tools.spotify_service import SpotifyService
from tools.gateway_api import GatewayClient
from core.memory import MemoryManager
from tools.weather_service import WeatherService

# Configuration from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://gateway:8000")

# Singleton instances
# By instantiating these once here, we reuse the HTTP connection pools across all requests
llm_provider = OpenAIProvider(api_key=OPENAI_API_KEY, model="gpt-5-mini")
gateway_client = GatewayClient(base_url=GATEWAY_URL)
memory_manager = MemoryManager()
weather_service = WeatherService()
spotify_service = SpotifyService()

# Base Persona
SYSTEM_PROMPT = """
You are the AI Orchestrator for {homename}.
Your job is to assist the user by manipulating the smart devices.
Be very concise, responses will be read aloud and should be natural but efficient.
Keep responses short and to the point, as they will be read aloud.

Current Home State:
{homestate}

Current Spotify Information:
{spotifyinfo}

Current Time and Date:
{timeinfo}

Current Weather Information:
{weatherinfo}

User Information:
{userprofile}

Rules:
1. Only control devices you see in the Home State.
2. If asked to turn on a light, use the `set_device_state` tool with the devices friendly name.
3. Be concise and conversational. Do not list device IDs to the user. Keep interactions short and natural.
4. If the user requests specific music, search for exact matches before playing with a general query.
"""

TOOL_REGISTRY = {
    # Home Control
    "set_device_state": gateway_client.set_device_state,
    "rename_group": gateway_client.rename_group,
    
    # Memory
    "update_user_profile": memory_manager.update_user_profile,

    # Weather
    "get_weather": weather_service.get_weather,

    # spotify
    "spotify_play": spotify_service.spotify_play,
    "spotify_controller": spotify_service.spotify_controller,
    "spotify_get_advanced_info": spotify_service.spotify_get_advanced_info,
    "spotify_search": spotify_service.spotify_search,
}

orchestrator = SmartHomeOrchestrator(
    llm_provider=llm_provider,
    gateway_client=gateway_client,
    memory_manager=memory_manager,
    weather_service=weather_service,
    spotify_service=spotify_service,
    system_prompt_tmpl=SYSTEM_PROMPT,
    tool_map=TOOL_REGISTRY
)

def get_orchestrator() -> SmartHomeOrchestrator:
    """FastAPI Dependency for injecting the orchestrator into routes."""
    return orchestrator