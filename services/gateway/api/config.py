from functools import lru_cache
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- MQTT Configuration ---
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 1883
    mqtt_username: Optional[str] = None
    mqtt_password: Optional[str] = None
    z2m_base: str = "zigbee2mqtt"

    # --- Redis Configuration ---
    # Defaulting to localhost database 0
    redis_url: str = "redis://127.0.0.1:6379/0"

    # --- Server Configuration ---
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: List[str] = ["*"]

    # Instruct Pydantic to read from the .env file
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

@lru_cache()
def get_config() -> Settings:
    """
    Dependency injection helper. 
    @lru_cache ensures we only read the .env file from disk once.
    """
    return Settings()