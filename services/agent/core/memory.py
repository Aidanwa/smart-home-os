import uuid
import logging
from typing import Dict, Any, List
from sqlalchemy.future import select
from shared.database.core import AsyncSessionLocal
from shared.database.models import UserPreference
from datetime import datetime, timedelta
import os
import json

logger = logging.getLogger(__name__)

class MemoryManager:
    def __init__(self):
        # Structure: {"user_id": [{"timestamp": datetime, "message": {...}}]}
        self._short_term: Dict[str, List[Dict[str, Any]]] = {}

    # --- Short-Term Memory (1-Hour Sliding Window) ---
    
    def get_history(self, user_id: str) -> List[Dict[str, Any]]:
        """Retrieves history, automatically pruning messages older than 1 hour."""
        if user_id not in self._short_term:
            return []
            
        cutoff = datetime.now() - timedelta(hours=1)
        
        # Prune old messages
        self._short_term[user_id] = [
            item for item in self._short_term[user_id] 
            if item["timestamp"] > cutoff
        ]
        
        # Return just the message dicts for the LLM
        return [item["message"] for item in self._short_term[user_id]]

    def add_message(self, user_id: str, message: Dict[str, Any]):
        """Appends a single message to the user's short-term history."""
        if user_id not in self._short_term:
            self._short_term[user_id] = []
            
        self._short_term[user_id].append({
            "timestamp": datetime.now(),
            "message": message
        })

    def delete_history(self, user_id: str):
        """Clears the user's short-term history."""
        self._short_term[user_id] = []
        return

    def pretty_print_history(self, user_id: str):
        """
        Logs a nicely formatted, human-readable view of a user's 
        short-term memory for debugging purposes.
        """
        history = self._short_term.get(user_id, [])
        
        output = []
        output.append(f"\n{'='*60}")
        output.append(f"SHORT-TERM MEMORY: {user_id}")
        output.append(f"Total Messages: {len(history)}")
        output.append(f"{'='*60}")

        if not history:
            output.append("  (Empty)\n")
            logger.info("\n".join(output))
            return

        for i, item in enumerate(history):
            timestamp = item["timestamp"].strftime("%H:%M:%S")
            message = item["message"]
            
            # Extract role for quick scanning, default to UNKNOWN
            role = message.get("role", "FUNCTION").upper()
            
            output.append(f"\n[{i+1}] {timestamp} | {role}")
            output.append("-" * 60)
            
            # If it's a standard text message, pull 'content' out for easy reading
            if "content" in message and isinstance(message["content"], str):
                output.append(message["content"])
                
                # Print any leftover keys (like tool_calls, name, etc.) as indented JSON
                other_keys = {k: v for k, v in message.items() if k != "content" and v}
                if other_keys:
                    output.append("\n[Metadata]:")
                    # default=str prevents crashes if there are nested datetimes or weird objects
                    output.append(json.dumps(other_keys, indent=2, default=str))
            else:
                # If there is no string content (e.g., pure tool calls), print the whole thing
                output.append(json.dumps(message, indent=2, default=str))
                
        output.append(f"\n{'='*60}\n")
        
        logger.info("\n".join(output))

    # --- Long-Term Memory (Persistent Text File) ---
    
    async def get_user_memory_facts(self, user_id: str) -> list[str]:
        """Reads the user's persistent memory facts from the database."""
        try:
            uid = uuid.UUID(user_id)
            
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(UserPreference).where(UserPreference.user_id == uid)
                )
                pref_record = result.scalar_one_or_none()
                
                if pref_record and pref_record.agent_settings:
                    memory_data = pref_record.agent_settings.get("user_memory", [])
                    
                    # BACKWARDS COMPATIBILITY: If the existing memory is the old string format,
                    # convert it to a list containing that single string.
                    if isinstance(memory_data, str):
                        return [memory_data] if memory_data else []
                        
                    return memory_data
                
                return []
        except ValueError:
            logger.error(f"Invalid UUID format provided for user_id: {user_id}")
            return []
        except Exception as e:
            logger.error(f"Failed to fetch user profile from database: {e}")
            return []

    async def update_user_memory(self, user_id: str, operations: list[dict]) -> Dict[str, Any]:
        """Tool: Applies targeted diff operations (add/update/remove) to the user's memory array."""
        try:
            uid = uuid.UUID(user_id)
            
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(UserPreference).where(UserPreference.user_id == uid)
                )
                pref_record = result.scalar_one_or_none()

                # 1. Fetch current facts (safely handling legacy strings)
                current_settings = {}
                current_facts = []
                
                if pref_record:
                    # Create a new dict to trigger SQLAlchemy JSONB mutation tracking
                    current_settings = dict(pref_record.agent_settings) if pref_record.agent_settings else {}
                    raw_memory = current_settings.get("user_memory", [])
                    current_facts = [raw_memory] if isinstance(raw_memory, str) and raw_memory else (raw_memory if isinstance(raw_memory, list) else [])

                # 2. Process Operations sequentially (sorting removals from high to low index)
                modified = False
                sorted_ops = sorted(
                    operations, 
                    key=lambda x: x.get("fact_id") if x.get("fact_id") is not None else -1, 
                    reverse=True
                )

                for op_data in sorted_ops:
                    op = op_data.get("op")
                    fact_id = op_data.get("fact_id")
                    content = op_data.get("content")

                    if op == "add" and content:
                        current_facts.append(content)
                        modified = True
                    elif op == "update" and fact_id is not None and content:
                        if 0 <= fact_id < len(current_facts):
                            current_facts[fact_id] = content
                            modified = True
                    elif op == "remove" and fact_id is not None:
                        if 0 <= fact_id < len(current_facts):
                            current_facts.pop(fact_id)
                            modified = True

                # 3. Save back to DB if changes occurred
                if modified:
                    current_settings["user_memory"] = current_facts
                    
                    if pref_record:
                        pref_record.agent_settings = current_settings
                    else:
                        new_pref = UserPreference(
                            user_id=uid,
                            ui_settings={},
                            agent_settings=current_settings
                        )
                        session.add(new_pref)
                    
                    await session.commit()
                    return {"status": "success", "message": "Memory successfully updated via diff patch."}
                
                return {"status": "success", "message": "No memory changes were required."}
                
        except ValueError:
            return {"status": "error", "message": "Failed to patch memory: Invalid User ID format."}
        except Exception as e:
            logger.error(f"Database error patching memory for {user_id}: {e}")
            return {"status": "error", "message": "Failed to patch memory in database vault."}