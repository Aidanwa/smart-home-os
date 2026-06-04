import asyncio
import logging
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
import websockets  # Replaces the invalid httpx websocket method

from core.mqtt_bus import AsyncMqttBus
from api.config import get_config
from api.routes import router, ws_router
from api.auth_routes import auth_router, platform_router
from api.integration_routes import integrations_router
from api.home_routes import router as home_router

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

    # RE-ADDED: CORS Middleware for local Vite development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8000", 
            "http://127.0.0.1:8000",
            "http://localhost:5173"
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Mount core routers
    app.include_router(router)
    app.include_router(ws_router)
    app.include_router(auth_router)
    app.include_router(platform_router)
    app.include_router(integrations_router)
    app.include_router(home_router)

    # ----------------------------------------------------------------------
    # UNIFIED WILD-CARD REVERSE PROXY PIPELINE (The Agent Container Boundary)
    # ----------------------------------------------------------------------

    # A. Capture all standard REST paths dynamically (GET history, configurations)
    @app.api_route("/api/agent/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def dynamic_agent_rest_proxy(path: str, request: Request):
        target_url = f"http://agent:8001/api/agent/{path}"
        
        query_params = dict(request.query_params)
        incoming_body = await request.body()
        
        # Forward safe headers (skip 'host' to avoid DNS resolution conflicts)
        safe_headers = ("cookie", "content-type", "user-agent", "accept", "authorization")
        headers = {k: v for k, v in request.headers.items() if k.lower() in safe_headers}
        
        async with httpx.AsyncClient() as client:
            try:
                res = await client.request(
                    method=request.method,
                    url=target_url,
                    params=query_params,
                    headers=headers,
                    content=incoming_body,
                    timeout=15.0
                )
                return Response(content=res.content, status_code=res.status_code, headers=dict(res.headers))
            except httpx.RequestError as exc:
                logger.error(f"Failed to reverse proxy rest traffic to /api/agent/{path}: {exc}")
                # Fixed: JSON is now properly imported
                return Response(
                    content=json.dumps({"detail": "Agent orchestration container unreachable."}), 
                    status_code=502, 
                    media_type="application/json"
                )

    # B. Capture all streaming WebSocket connections cleanly
    @app.websocket("/api/agent/chat/stream")
    async def dynamic_agent_websocket_proxy(websocket: WebSocket):
        await websocket.accept()
        
        # Guard type resolution explicitly to guarantee str type objects exclusively
        raw_cookie = websocket.headers.get("cookie")
        
        # Build dict ONLY if a valid non-empty string is present, otherwise force an explicit clean dict
        additional_headers = {}
        if raw_cookie and isinstance(raw_cookie, str) and raw_cookie.strip():
            additional_headers["Cookie"] = str(raw_cookie)
        
        try:
            # Connect downstream utilizing a safe dict structure that never passes None values
            async with websockets.connect(
                "ws://agent:8001/api/agent/chat/stream", 
                additional_headers=additional_headers if additional_headers else None
            ) as target_ws:
                
                async def client_to_agent():
                    try:
                        while True:
                            msg = await websocket.receive_text()
                            await target_ws.send(msg)
                    except WebSocketDisconnect:
                        pass
                    except Exception:
                        pass

                async def agent_to_client():
                    try:
                        while True:
                            msg = await target_ws.recv()
                            await websocket.send_text(msg)
                    except WebSocketDisconnect:
                        pass
                    except Exception:
                        pass

                # Handle bidirectional transportation loops concurrently
                await asyncio.gather(client_to_agent(), agent_to_client())
                
        except Exception as e:
            logger.error(f"Failed to mount agent tunnel link cross-stream proxy boundary: {str(e)}")
            try:
                await websocket.send_text("\n[System Error: Agent container websocket tunnel handshake failed.]")
                await websocket.send_text("[DONE]")
                await websocket.close(code=1011)
            except:
                pass

    # ----------------------------------------------------------------------
    # STATIC ASSET ROUTING & SPA FALLBACK SHELL
    # ----------------------------------------------------------------------
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

    if os.path.exists(FRONTEND_DIST):
        logger.info(f"Serving frontend assets from {FRONTEND_DIST}")
        
        app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
        
        @app.get("/{catchall:path}")
        async def serve_spa(catchall: str):
            file_path = os.path.join(FRONTEND_DIST, catchall)
            
            if os.path.exists(file_path) and os.path.isfile(file_path):
                return FileResponse(file_path)
                
            return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    else:
        logger.warning(f"Frontend dist folder not found at {FRONTEND_DIST}. Running in API-only mode.")
        
    return app

app = create_app()


