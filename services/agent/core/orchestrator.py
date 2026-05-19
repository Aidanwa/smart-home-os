import logging
import json
from typing import Callable, List, Dict, Any, AsyncGenerator
from core.memory import MemoryManager
from tools.gateway_api import GatewayClient
from providers.base import BaseLLMProvider

logger = logging.getLogger(__name__)

class SmartHomeOrchestrator:
    def __init__(
        self,
        llm_provider: BaseLLMProvider,       
        gateway_client: GatewayClient,     
        memory_manager: MemoryManager,     
        system_prompt_tmpl: str, 
        tools_schema: List[Dict],
        tool_map: Dict[str, Callable],
    ):
        self.llm = llm_provider
        self.gateway = gateway_client
        self.memory = memory_manager
        self.system_prompt_tmpl = system_prompt_tmpl
        self.tools_schema = tools_schema
        self.tool_map = tool_map
        self.max_iterations = 5 

    async def process_intent_stream(self, user_id: str, user_text: str) -> AsyncGenerator[Dict[str, Any], None]:
        # 1. Fetch Data
        home_context = await self.gateway.get_filtered_context(user_id)
        logger.debug(f"Fetched home context for {user_id}: {home_context}")
        user_profile = self.memory.get_user_profile(user_id)
        logger.debug(f"Fetched user profile for {user_id}: {user_profile}")

        # 2. Build Instructions
        instructions = self.system_prompt_tmpl.format(
            homestate=home_context,
            userprofile=user_profile
        )

        # 3. Retrieve Pruned History (1 Hour Limit)
        history = self.memory.get_history(user_id)
        
        # Start message array with System, then History, then the New Query
        current_messages = [{"role": "system", "content": instructions}]
        current_messages.extend(history)
        
        new_msg = {"role": "user", "content": user_text}
        current_messages.append(new_msg)
        self.memory.add_message(user_id, new_msg) # Save to memory

        # The Agentic Loop
        for iteration in range(self.max_iterations):
            logger.debug(f"Streaming Loop {iteration + 1}/{self.max_iterations}")

            stream = self.llm.generate_stream(
                messages=current_messages,
                tools=self.tools_schema
            )

            # We must accumulate text as it streams so we can save the final paragraph to memory
            accumulated_text = ""

            # Process the incoming stream
            async for chunk in stream:
                if chunk["type"] == "text_chunk":
                    accumulated_text += chunk["content"]
                    # Pass text directly back to the UI instantly
                    yield chunk
                
                elif chunk["type"] == "error":
                    yield {"type": "text_chunk", "content": f"\n[Error: {chunk['content']}]"}
                    return

                elif chunk["type"] == "done":
                    # The LLM is finished speaking. Save the final compiled text to memory.
                    if accumulated_text:
                        assistant_msg = {"role": "assistant", "content": accumulated_text}
                        current_messages.append(assistant_msg)
                        self.memory.add_message(user_id, assistant_msg)
                    return
                
                elif chunk["type"] == "tool_calls":
                    assistant_msg = chunk.get("message")
                    current_messages.extend(assistant_msg)
                    for msg in assistant_msg:
                        self.memory.add_message(user_id, msg)

                    # 2. Execute the tools
                    tool_calls = chunk["message"]
                    tool_results = await self._execute_tool_calls(user_id, tool_calls)
                    
                    # 3. Append the tool results to current array AND to memory
                    current_messages.extend(tool_results)
                    for tr in tool_results:
                        self.memory.add_message(user_id, tr)
                    
                    break # Break inner stream loop to restart outer LLM loop with updated context

        # Failsafe
        yield {"type": "text_chunk", "content": "\n[System: Max reasoning steps reached.]"}


    async def _execute_tool_calls(self, user_id: str, tool_calls: List[Dict]) -> List[Dict]:
        results = []
        for call in tool_calls:
            tool_id = call.get("id")
            tool_name = call.get("name")
            try:
                args = json.loads(call.get("arguments", "{}"))
                
                tool_method = self.tool_map.get(tool_name)
                
                if not tool_method:
                    raise AttributeError(f"Tool '{tool_name}' is not registered.")
                
                result_data = await tool_method(user_id=user_id, **args)
                
            except Exception as e:
                result_data = {"error": str(e)}

            # Standardized tool result format expected by most major LLMs
            results.append({
                "type": "function_call_output",
                "call_id": tool_id,
                "output": json.dumps(result_data)
            })
            
        return results