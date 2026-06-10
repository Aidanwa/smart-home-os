from pydantic import BaseModel
from typing import List, Dict, Any

class ChatResponse(BaseModel):
    response: str

class HistoryResponse(BaseModel):
    user_id: str
    messages: List[Dict[str, Any]]

