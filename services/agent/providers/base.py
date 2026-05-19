from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, AsyncGenerator

class BaseLLMProvider(ABC):
    """
    The abstract interface for all language model integrations using streaming.
    """
    
    @abstractmethod
    async def generate_stream(
        self, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None,
        previous_response_id: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Streams the response from the LLM.
        
        Yields:
            Dicts representing either text chunks or completed tool calls:
            - {"type": "text_chunk", "content": "..."}
            - {"type": "tool_calls", "response_id": "...", "tool_calls": [...]}
            - {"type": "done", "response_id": "..."}
        """
        pass