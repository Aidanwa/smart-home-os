import asyncio
import logging
import json
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
import websockets  # Replaces the invalid httpx websocket method

from core.mqtt_bus import AsyncMqttBus
from api.config import get_config
from api.routes import router, ws_router, WS_KEEPALIVE_S, WS_KEEPALIVE_MSG
from api.auth_routes import auth_router, platform_router
from api.integration_routes import integrations_router
from api.home_routes import router as home_router
from api.zone_routes import router as zone_router
from api.routine_routes import router as routine_router
from api.push_routes import router as push_router
from api.device_settings_routes import router as device_settings_router

# The installed app's manifest (frontend/public); Python doesn't know the extension.
mimetypes.add_type("application/manifest+json", ".webmanifest")
from scheduler.engine import Scheduler
from core.rooms import RoomOccupancy

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

    # 3. Room occupancy from presence sensors (before the scheduler, whose room triggers read it)
    rooms = RoomOccupancy(bus)
    app.state.rooms = rooms
    await rooms.start()

    # 4. Routine scheduler (never raises; logs and stays inactive on failure)
    scheduler = Scheduler(bus)
    app.state.scheduler = scheduler
    await scheduler.start()

    yield  # --- The API is now running and accepting requests ---

    # Shutdown
    logger.info("Shutting down Gateway...")
    await scheduler.stop()
    await rooms.stop()
    await bus.stop()

# Create FastAPI app
def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart Home Gateway",
        description="FastAPI mqtt orchestrator with Redis Digital Twin",
        lifespan=lifespan,
        # No public API map: /docs, /redoc and /openapi.json are unauthenticated otherwise.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
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
    app.include_router(zone_router)
    app.include_router(routine_router)
    app.include_router(push_router)
    app.include_router(device_settings_router)

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
        raw_cookie = websocket.headers.get("cookie")
        additional_headers = {"Cookie": raw_cookie} if raw_cookie and raw_cookie.strip() else None

        # Connect to the agent *before* accepting the browser. If the agent is down (e.g. ~40 s
        # of Whisper loading after a deploy), the browser's handshake fails and it retries with
        # backoff, instead of seeing an "open" socket with nothing behind it.
        try:
            target_ws = await websockets.connect(
                "ws://agent:8001/api/agent/chat/stream", additional_headers=additional_headers
            )
        except Exception as e:
            logger.warning(f"Agent chat proxy: agent unreachable ({e}); rejecting browser socket")
            await websocket.close(code=1013)  # before accept() this rejects the handshake
            return

        await websocket.accept()
        send_lock = asyncio.Lock()  # keepalives and agent output both write to the browser

        async def client_to_agent():
            while True:
                await target_ws.send(await websocket.receive_text())

        async def agent_to_client():
            while True:
                msg = await target_ws.recv()
                async with send_lock:
                    await websocket.send_text(msg)

        async def keepalive():
            while True:
                await asyncio.sleep(WS_KEEPALIVE_S)
                async with send_lock:
                    await websocket.send_text(WS_KEEPALIVE_MSG)

        tasks = [asyncio.create_task(c()) for c in (client_to_agent, agent_to_client, keepalive)]
        try:
            # Whichever side ends first (browser left, agent restarted, send failed) ends the
            # session. With gather, an agent restart left the browser side open and "Online".
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await target_ws.close()
            # Pass on the agent's auth (1008) / config (1011) refusals so the browser doesn't
            # retry them in a loop; anything else is "service restart" (1012) and it reconnects.
            code = target_ws.close_code if target_ws.close_code in (1008, 1011) else 1012
            try:
                await websocket.close(code=code)
            except Exception:
                pass  # already closed by the browser

    # ----------------------------------------------------------------------
    # STATIC ASSET ROUTING & SPA FALLBACK SHELL
    # ----------------------------------------------------------------------
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

    if os.path.exists(FRONTEND_DIST):
        logger.info(f"Serving frontend assets from {FRONTEND_DIST}")
        
        app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
        
        dist_root = Path(FRONTEND_DIST).resolve()

        @app.get("/{catchall:path}")
        async def serve_spa(catchall: str):
            # catchall is percent-decoded, so "..%2f" arrives as "../" and an absolute
            # path would replace dist_root in a join. Resolve and require containment.
            file_path = (dist_root / catchall).resolve()

            # Everything outside /assets (index.html, sw.js, the manifest, icons) keeps the
            # same URL across deploys, so the browser must revalidate it every time (cheap:
            # ETag). Without this, iOS reused a stale index.html pointing at the previous
            # build's hashed /assets files, which 404 after a deploy: a blank white app.
            no_cache = {"Cache-Control": "no-cache"}
            if file_path.is_relative_to(dist_root) and file_path.is_file():
                return FileResponse(file_path, headers=no_cache)

            return FileResponse(dist_root / "index.html", headers=no_cache)
    else:
        logger.warning(f"Frontend dist folder not found at {FRONTEND_DIST}. Running in API-only mode.")
        
    return app

app = create_app()


