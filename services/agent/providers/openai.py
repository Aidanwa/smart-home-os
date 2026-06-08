import logging
import os
from typing import List, Dict, Any, Optional, AsyncGenerator
from httpcore import stream
from openai import AsyncOpenAI

from .base import BaseLLMProvider

logger = logging.getLogger(__name__)

class OpenAIProvider(BaseLLMProvider):
    """
    Implementation of the BaseLLMProvider using OpenAI's new Responses API.
    Supports native streaming, stateful storage, and agentic tool usage.
    """
    def __init__(self, api_key: Optional[str], model: str = "gpt-5-mini"):
        clean_api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.client = AsyncOpenAI(api_key=clean_api_key)
        self.model = model

    async def generate_stream(
        self, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Streams the response using the Responses API.
        Yields text chunks as they arrive, and finally yields the completed 
        tool calls (if any) so the Orchestrator can execute them.
        """
        logger.debug(f"Calling Responses API ({self.model}) with streaming.")

        # Separate Instructions (System Prompt) from Input
        instructions = ""
        inputs = []
        for msg in messages:
            if msg.get("role") == "system":
                instructions = msg.get("content", "")
            else:
                sanitized_msg = dict(msg)
                if sanitized_msg.get("role") == "assistant" and sanitized_msg.get("content") is None:
                    sanitized_msg["content"] = ""
                    
                inputs.append(sanitized_msg)

        # Format Tools for the Responses API
        formatted_tools = []
        if tools:
            for tool in tools:
                formatted_tools.append({
                    "type": "function",
                    "name": tool.get("name"),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                })

        # Build the payload
        kwargs = {
            "model": self.model,
            "instructions": instructions,
            "input": inputs,
            "store": False,
            "stream": True,
        }

        if formatted_tools:
            kwargs["tools"] = formatted_tools

        logger.debug(f"Initiating streaming response with model {self.model}.")
        try:
            # Execute the stream
            stream = await self.client.responses.create(**kwargs)
            
            # We need to accumulate tool calls because they stream in chunks
            accumulated_tool_calls = {}
            final_response_id = None

            async for chunk in stream:
                # 1. Grab the response ID (It arrives on the initial 'response.created' event)
                if chunk.type == "response.created" and hasattr(chunk, 'response'):
                    final_response_id = chunk.response.id

                # 2. Handle Text streaming
                if chunk.type == "response.output_text.delta":
                    yield {
                        "type": "text_chunk", 
                        # Note: The Responses API puts the string directly on chunk.delta
                        "content": chunk.delta 
                    }
                
                # 3. Handle Tool Calls
                elif chunk.type == "response.output_item.added":
                    if hasattr(chunk, 'item') and chunk.item.type == "function_call":
                        tc_id = chunk.item.id
                        accumulated_tool_calls[tc_id] = {
                            "type": "function_call",
                            "status": "completed",
                            "id": tc_id,
                            "call_id": tc_id,
                            "name": chunk.item.name,
                            "arguments": ""
                        }

                elif chunk.type == "response.function_call_arguments.delta":
                    tc_id = chunk.item_id
                    if tc_id in accumulated_tool_calls:
                        accumulated_tool_calls[tc_id]["arguments"] += chunk.delta

            # Once the stream ends, yield the final tool calls if any exist
            if accumulated_tool_calls:
                yield {
                    "type": "tool_calls",
                    "response_id": final_response_id,
                    "message": list(accumulated_tool_calls.values())
                }
            else:
                # If no tools were called, signal completion
                yield {
                    "type": "done",
                    "response_id": final_response_id
                }

        except Exception as e:
            logger.error(f"Responses API Stream Error: {str(e)}")
            yield {
                "type": "error",
                "content": f"Connection error: {str(e)}"
            }