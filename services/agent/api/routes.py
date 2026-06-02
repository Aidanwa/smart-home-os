import logging
import json
import jwt
import os
from http.cookies import SimpleCookie
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, Cookie, status
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from api.dependencies import get_orchestrator
from core.orchestrator import SmartHomeOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agentic Chat"])

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "7b9d8df2ac3ce72b8d0093cf1b988fce899ea298b11119fcd5c95279da7311ef")
ALGORITHM = "HS256"

# Cryptographic Token Extraction Helper
def extract_user_id_from_cookie(cookie_string: Optional[str]) -> str:
    if not cookie_string:
        raise HTTPException(status_code=401, detail="Session token missing.")
    
    cookie = SimpleCookie()
    cookie.load(cookie_string)
    if "access_token" not in cookie:
        raise HTTPException(status_code=401, detail="Access authentication cookie absent.")
        
    token = cookie["access_token"].value
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid session subject.")
        return user_id
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session context expired or signature mismatch.")

class ChatResponse(BaseModel):
    response: str

class HistoryResponse(BaseModel):
    user_id: str
    messages: List[Dict[str, Any]]

@router.websocket("/chat/stream")
async def chat_stream(
    websocket: WebSocket, 
    orchestrator: SmartHomeOrchestrator = Depends(get_orchestrator)
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
    except HTTPException as e:
        await websocket.send_text(f"\n[Auth Error: {e.detail}]")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    logger.info(f"WebSocket agent loop initialized for verified profile: {user_id}")
    
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
    orchestrator: SmartHomeOrchestrator = Depends(get_orchestrator)
):
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    try:
        history = orchestrator.memory.get_history(user_id)
        return {"user_id": user_id, "messages": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to pull historical timeline.")

@router.post("/chat", response_model=ChatResponse)
async def chat_sync(
    request: Request,
    body: Dict[str, str],
    orchestrator: SmartHomeOrchestrator = Depends(get_orchestrator)
):
    user_id = extract_user_id_from_cookie(request.headers.get("cookie"))
    user_text = body.get("text", "")
    
    full_response = ""
    try:
        async for chunk in orchestrator.process_intent_stream(user_id, user_text):
            if chunk["type"] == "text_chunk":
                full_response += chunk["content"]
        return ChatResponse(response=full_response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))