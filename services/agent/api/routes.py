# services/agent/api/routes.py
import logging
import json
import jwt
import os
from http.cookies import SimpleCookie
from fastapi import (
    APIRouter, WebSocket, WebSocketDisconnect, Depends, 
    HTTPException, Request, status, BackgroundTasks,
    UploadFile, File
)
from typing import Dict, Optional
from api.models import ChatResponse, HistoryResponse
import tempfile

from api.dependencies import get_orchestrator, stt_model
from core.orchestrator import SmartHomeOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agentic Chat"])

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = "HS256"

# Cryptographic Token Extraction Helper
def extract_user_id_from_cookie(cookie_string: Optional[str]) -> str:
    if not cookie_string:
        logger.warning("No cookie header found in request.")
        raise HTTPException(status_code=401, detail="Session token missing.")
    
    cookie = SimpleCookie()
    cookie.load(cookie_string)
    if "access_token" not in cookie:
        logger.warning("Access token cookie not found in cookie header.")
        raise HTTPException(status_code=401, detail="Access authentication cookie absent.")
        
    token = cookie["access_token"].value
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            logger.warning("Invalid session subject.")
            raise HTTPException(status_code=401, detail="Invalid session subject.")
        logger.debug(f"Authenticated user_id extracted from cookie: {user_id}")
        return user_id
    except jwt.PyJWTError:
        logger.warning("Session context expired or signature mismatch.")
        raise HTTPException(status_code=401, detail="Session context expired or signature mismatch.")

@router.websocket("/chat/stream")
async def chat_stream(
    websocket: WebSocket, 
    orchestrator_factory = Depends(get_orchestrator)
):
    """
    Persistent WebSocket connection utilizing native cookie extraction 
    to map the independent orchestrator run against a verified PostgreSQL account.
    """
    await websocket.accept()
    
    try:
        # Extract cookie from raw headers to ensure multi-browser/proxy safety
        cookie_header = websocket.headers.get("cookie")
        user_id = extract_user_id_from_cookie(cookie_header)
        
        # Build the custom session orchestrator using DB preferences
        orchestrator = await orchestrator_factory(user_id)
        
    except HTTPException as e:
        await websocket.send_text(f"\n[Auth Error: {e.detail}]")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except ValueError as e:
        # Catches missing API Key scenarios cleanly
        await websocket.send_text(f"\n[Configuration Error: {str(e)}]")
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    logger.debug(f"WebSocket agent loop initialized for verified profile: {user_id}")
    
    try:
        while True:
            user_text = await websocket.receive_text()
            async for chunk in orchestrator.process_intent_stream(user_id, user_text):
                if chunk["type"] == "text_chunk":
                    await websocket.send_text(chunk["content"])
                elif chunk["type"] == "tool_call":
                    await websocket.send_text(json.dumps(chunk))
            
            await websocket.send_text("[DONE]")
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket closed for profile context: {user_id}")
    except Exception as e:
        logger.error(f"Internal Orchestration Processing Error: {str(e)}")
        try:
            await websocket.send_text(f"\n[System Error: {str(e)}]")
            await websocket.send_text("[DONE]")
        except:
            pass

@router.get("/chat/history", response_model=HistoryResponse)
async def get_user_chat_history(
    request: Request,
    orchestrator_factory = Depends(get_orchestrator)
):
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    try:
        orchestrator: SmartHomeOrchestrator = await orchestrator_factory(user_id)
        history = orchestrator.memory.get_history(user_id)
        return {"user_id": user_id, "messages": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to pull historical timeline.")
    
@router.delete("/chat/history", response_model=HistoryResponse)
async def delete_user_chat_history(
    request: Request,
    orchestrator_factory = Depends(get_orchestrator)
):
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    try:
        orchestrator: SmartHomeOrchestrator = await orchestrator_factory(user_id)
        orchestrator.memory.delete_history(user_id)
        return {"user_id": user_id, "messages": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to delete historical timeline.")

@router.post("/chat", response_model=ChatResponse)
async def chat_sync(
    request: Request,
    body: Dict[str, str],
    orchestrator_factory = Depends(get_orchestrator)
):
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    user_text = body.get("text", "")
    
    full_response = ""
    try:
        orchestrator: SmartHomeOrchestrator = await orchestrator_factory(user_id)
        async for chunk in orchestrator.process_intent_stream(user_id, user_text):
            if chunk["type"] == "text_chunk":
                full_response += chunk["content"]
        return ChatResponse(response=full_response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/initialize")
async def initialize_chat( 
    request: Request,
    background_tasks: BackgroundTasks,
    orchestrator_factory = Depends(get_orchestrator)
):
    """Pre-fetches weather and home info to reduce first-message latency."""
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    try:
        orchestrator: SmartHomeOrchestrator = await orchestrator_factory(user_id)
        background_tasks.add_task(orchestrator.spotify.cache_user_playlists, user_id=user_id)
        background_tasks.add_task(orchestrator.initialize_session,user_id=user_id)
        return
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/voice")
async def process_voice_command(
    request: Request,
    audio_file: UploadFile = File(...),
):
    """Receives a browser audio blob, transcribes it locally, and returns text."""
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    
    if not stt_model:
        raise HTTPException(status_code=500, detail="STT Model not configured on backend.")

    # Save the uploaded webm/mp4 blob to a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        content = await audio_file.read()
        temp_audio.write(content)
        temp_audio_path = temp_audio.name

    try:
        # Faster-Whisper automatically handles ffmpeg conversion from webm to 16khz pcm!
        # beam_size=1 makes it faster for real-time edge devices
        segments, info = stt_model.transcribe(temp_audio_path, beam_size=1)
        
        transcription = " ".join([segment.text for segment in segments]).strip()
        
        logger.info(f"User {user_id} voice transcribed: '{transcription}'")
        
        return {"status": "success", "text": transcription}
        
    except Exception as e:
        logger.error(f"Voice processing failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to process audio")
    finally:
        # Always clean up the temp file
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)