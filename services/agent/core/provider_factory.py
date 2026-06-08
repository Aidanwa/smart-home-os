# services/agent/core/provider_factory.py
""" This file serves the correct construction of LLM provider instances based on user-specific settings stored in the database.
It abstracts away the logic of determining which provider to use and how to fetch the necessary API keys"""
import os
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from shared.database.models import UserPreference, UserSecret
from providers.openai import OpenAIProvider
from providers.base import BaseLLMProvider

logger = logging.getLogger(__name__)

async def build_llm_provider(user_id: str, db: AsyncSession) -> BaseLLMProvider:
    """
    Dynamically builds the correct LLM provider based on the user's database settings.
    """
    # 1. Fetch User Preferences
    pref_result = await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    prefs = pref_result.scalar_one_or_none()
    
    # Defaults
    provider_name = "openai"
    model_name = "gpt-5-mini"
    use_system_key = True
    
    if prefs and prefs.agent_settings:
        agent_settings = prefs.agent_settings
        provider_name = agent_settings.get("provider", provider_name)
        model_name = agent_settings.get("model", model_name)
        use_system_key = agent_settings.get("use_system_api_key", use_system_key)
        
    api_key = None
    
    # 2. Fetch User Secret if not using system key
    if not use_system_key:
        secret_result = await db.execute(
            select(UserSecret).where(
                UserSecret.user_id == user_id, 
                UserSecret.provider == provider_name
            )
        )
        secret = secret_result.scalar_one_or_none()
        if secret:
            # NOTE: If you add symmetric encryption later, decrypt here before assignment
            api_key = secret.encrypted_credentials
            
    # 3. Fallback to System Key
    if not api_key and use_system_key:
        if provider_name == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
        # Add elif blocks for other providers' system keys here as you expand
        
    if not api_key:
        logger.warning(f"No API key found for user {user_id} using provider {provider_name}.")
        raise ValueError(f"Missing API key for {provider_name}. Please update your settings.")
        
    # 4. Initialize Provider
    if provider_name == "openai":
        return OpenAIProvider(api_key=api_key, model=model_name)
    elif provider_name == "anthropic":
        # return AnthropicProvider(api_key=api_key, model=model_name)
        pass
    elif provider_name == "ollama":
        # return OllamaProvider(model=model_name)
        pass
        
    # Default fallback
    return OpenAIProvider(api_key=api_key, model=model_name)