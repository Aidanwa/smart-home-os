# services/agent/api/dependencies.py
import os
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.orchestrator import SmartHomeOrchestrator
from tools.spotify_service import SpotifyService
from tools.gateway_api import GatewayClient
from core.memory import MemoryManager
from tools.weather_service import WeatherService
from shared.database.core import get_db
from core.provider_factory import build_llm_provider
from faster_whisper import WhisperModel
import logging

logger = logging.getLogger(__name__)

# Configuration from environment variables
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://gateway:8000")

# Singleton instances
# These services do not hold user-specific state, so they are perfectly safe to keep as globals
gateway_client = GatewayClient(base_url=GATEWAY_URL)
memory_manager = MemoryManager()
weather_service = WeatherService()
spotify_service = SpotifyService()

# Voice Services
try:
    # use compute_type="int8" for CPU efficiency on Raspberry Pi
    stt_model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    logger.info("Local Whisper STT model loaded.")
except ImportError:
    stt_model = None
    logger.warning("faster_whisper not installed. Voice input will fail.")

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
    # zigbee
    "set_device_state": gateway_client.set_device_state,

    # memory
    "update_memory": memory_manager.update_user_memory,

    #weather
    "get_weather": weather_service.get_weather,

    #spotify
    "spot_play": spotify_service.spotify_play,
    "spot_ctrl": spotify_service.spotify_controller,
    "spot_info": spotify_service.spotify_get_advanced_info,
    "spot_search": spotify_service.spotify_search,
    "spot_queue": spotify_service.spotify_queue_track,
    "spot_search_playlist": spotify_service.spotify_search_playlist,
}

async def get_orchestrator(db: AsyncSession = Depends(get_db)):
    """
    FastAPI Dependency returning a factory function.
    This safely delays building the Orchestrator until the route has validated the user's cookie.
    """
    async def build(user_id: str) -> SmartHomeOrchestrator:
        # Dynamically build the LLM provider for this specific user session
        llm_provider = await build_llm_provider(user_id, db)
        
        return SmartHomeOrchestrator(
            llm_provider=llm_provider,
            gateway_client=gateway_client,
            memory_manager=memory_manager,
            weather_service=weather_service,
            spotify_service=spotify_service,
            system_prompt_tmpl=SYSTEM_PROMPT,
            tool_map=TOOL_REGISTRY
        )
    return build