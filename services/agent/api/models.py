from pydantic import BaseModel
from typing import List, Dict, Any

class ChatRequest(BaseModel):
    text: str
    # The reply will be spoken (Siri via an iPhone Shortcut): short, plain sentences.
    voice: bool = False

class ChatResponse(BaseModel):
    response: str

class HistoryResponse(BaseModel):
    user_id: str
    messages: List[Dict[str, Any]]

