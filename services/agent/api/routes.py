import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import AsyncGenerator

from api.dependencies import get_orchestrator
from core.orchestrator import SmartHomeOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agentic Chat"])

# ---------------------------------------------------------
# Pydantic Schemas for REST Fallback
# ---------------------------------------------------------
class ChatRequest(BaseModel):
    user_id: str
    text: str

class ChatResponse(BaseModel):
    user_id: str
    response: str


# ---------------------------------------------------------
# Streaming WebSocket Route (For React UI)
# ---------------------------------------------------------
@router.websocket("/chat/stream")
async def chat_stream(
    websocket: WebSocket, 
    user_id: str, 
    orchestrator: SmartHomeOrchestrator = Depends(get_orchestrator)
):
    """
    Persistent WebSocket connection for real-time streaming chat.
    Connect via: ws://<agent-ip>:<port>/api/agent/chat/stream?user_id=aidan
    """
    await websocket.accept()
    logger.info(f"WebSocket connected for user: {user_id}")
    
    try:
        while True:
            # 1. Wait for the user to send a message
            user_text = await websocket.receive_text()
            logger.debug(f"Received message from {user_id}: {user_text}")
            
            # 2. Fire up the streaming orchestrator
            async for chunk in orchestrator.process_intent_stream(user_id, user_text):
                if chunk["type"] == "text_chunk":
                    # Instantly send the token to the React UI
                    await websocket.send_text(chunk["content"])
            
            # 3. Send a specific delimiter so the frontend knows the LLM is done thinking/typing
            await websocket.send_text("[DONE]")
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user: {user_id}")
    except Exception as e:
        logger.error(f"WebSocket Error for {user_id}: {str(e)}")
        try:
            await websocket.send_text(f"\n[System Error: {str(e)}]")
            await websocket.send_text("[DONE]")
        except:
            pass # Socket might already be closed


# ---------------------------------------------------------
# Standard REST Route (For Edge Nodes / Testing)
# ---------------------------------------------------------
@router.post("/chat", response_model=ChatResponse)
async def chat_sync(
    request: ChatRequest, 
    orchestrator: SmartHomeOrchestrator = Depends(get_orchestrator)
):
    """
    Standard HTTP POST fallback. 
    It runs the exact same streaming orchestrator but accumulates the chunks 
    server-side before returning the complete string.
    """
    logger.info(f"Sync chat request from {request.user_id}: {request.text}")
    
    full_response = ""
    # try:
    # We iterate over the stream but build a single string
    async for chunk in orchestrator.process_intent_stream(request.user_id, request.text):
        logger.debug(f"received chunk: {chunk}")
        if chunk["type"] == "text_chunk":
            full_response += chunk["content"]
            
    return ChatResponse(user_id=request.user_id, response=full_response)
        
    # except Exception as e:
    #     logger.error(f"REST Chat Error for {request.user_id}: {e}")
    #     raise HTTPException(status_code=500, detail=str(e))