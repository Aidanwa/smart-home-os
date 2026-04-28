import asyncio
import logging
from contextlib import asynccontextmanager
from logging import config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from core.mqtt_bus import AsyncMqttBus
from api.config import get_config
from api.routes import router

# Configure the logging format and level
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    config = get_config()

    logger.info("Starting Smart Home Gateway...")
    
    # 1. Initialize the Bus
    bus = AsyncMqttBus(
        mqtt_host=config.mqtt_host, 
        mqtt_port=config.mqtt_port, 
        mqtt_username=config.mqtt_username,
        mqtt_password=config.mqtt_password,
        redis_url=getattr(config, 'redis_url', 'redis://localhost:6379')
    )
    
    # Attach bus to the application state for Dependency Injection
    app.state.bus = bus

    # 2. Start the background MQTT listener loop
    await bus.start()
    
    # Give the MQTT client a moment to establish connection
    await asyncio.sleep(0.5)

    # 3. Startup Hydration: Force Z2M to broadcast all device states
    try:
        logger.info("Hydrating Digital Twin from Zigbee2MQTT...")
        
        if bus.client:

            # We don't need a full RPC here, just a publish to trigger the broadcast
            await bus.client.publish(
                "zigbee2mqtt/bridge/request/devices", 
                payload='{"transaction": "startup_hydration"}'
            )
            # Wait 1-2 seconds for the network to respond and Redis to fill
            await asyncio.sleep(3)
            logger.info("Hydration complete.")
    except Exception as e:
        logger.error(f"Failed to hydrate state: {e}")

    yield  # --- The API is now running and accepting requests ---

    # Shutdown
    logger.info("Shutting down Gateway...")
    await bus.stop()

# Create FastAPI app
def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart Home Gateway",
        description="FastAPI mqtt orchestrator with Redis Digital Twin",
        lifespan=lifespan,
    )
    
    # Mount routers
    app.include_router(router)
    return app

app = create_app()