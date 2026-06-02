import asyncio
import logging
from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from core.mqtt_bus import AsyncMqttBus
from api.config import get_config
from api.routes import router, ws_router
from api.auth_routes import auth_router, platform_router

# Configure the logging format and level
logging.basicConfig(
    level=logging.INFO,
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

    # ONLY UNCOMMENT TO RESET THE DIGITAL TWIN ON STARTUP - TESTING USE ONLY
    # await bus.redis.delete("gateway:digital_twin")

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
    app.include_router(ws_router)
    app.include_router(auth_router)
    app.include_router(platform_router)

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

    if os.path.exists(FRONTEND_DIST):
        logger.info(f"Serving frontend assets from {FRONTEND_DIST}")
        
        # Mount the assets directory explicitly (Vite puts JS/CSS here)
        app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
        
        # Catch-all route for SPA (Single Page Application) routing
        @app.get("/{catchall:path}")
        async def serve_spa(catchall: str):
            file_path = os.path.join(FRONTEND_DIST, catchall)
            
            # If the exact file exists (like favicon.ico, manifest.json), serve it
            if os.path.exists(file_path) and os.path.isfile(file_path):
                return FileResponse(file_path)
                
            # Otherwise, default to index.html for React Router to handle
            return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    else:
        logger.warning(f"Frontend dist folder not found at {FRONTEND_DIST}. Running in API-only mode.")
    return app

app = create_app()

