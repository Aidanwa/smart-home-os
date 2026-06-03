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
    
    async def get_user_profile(self, user_id: str) -> str:
        """Reads the user's persistent memory entry from the database."""
        try:
            # Ensure the user_id is a proper UUID object
            uid = uuid.UUID(user_id)
            
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(UserPreference).where(UserPreference.user_id == uid)
                )
                pref_record = result.scalar_one_or_none()
                
                if pref_record and pref_record.agent_settings:
                    # Extract the memory string, defaulting to empty if not set
                    return pref_record.agent_settings.get("user_memory", "")
                
                return ""
        except ValueError:
            logger.error(f"Invalid UUID format provided for user_id: {user_id}")
            return ""
        except Exception as e:
            logger.error(f"Failed to fetch user profile from database: {e}")
            return ""

    async def update_user_profile(self, user_id: str, new_content: str) -> Dict[str, Any]:
        """Tool: Overwrites the user's persistent memory field with new facts."""
        try:
            uid = uuid.UUID(user_id)
            
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(UserPreference).where(UserPreference.user_id == uid)
                )
                pref_record = result.scalar_one_or_none()

                if pref_record:
                    # IMPORTANT: Create a new dict from the existing one so SQLAlchemy 
                    # detects the mutation and triggers the UPDATE statement for the JSONB column.
                    current_settings = dict(pref_record.agent_settings) if pref_record.agent_settings else {}
                    current_settings["user_memory"] = new_content
                    pref_record.agent_settings = current_settings
                else:
                    # If the user has never saved a preference before, create the row
                    new_pref = UserPreference(
                        user_id=uid,
                        ui_settings={},
                        agent_settings={"user_memory": new_content}
                    )
                    session.add(new_pref)
                
                await session.commit()
                return {"status": "success", "message": "Memory successfully securely saved to vault."}
                
        except ValueError:
            return {"status": "error", "message": "Failed to save memory: Invalid User ID format."}
        except Exception as e:
            logger.error(f"Database error updating profile for {user_id}: {e}")
            return {"status": "error", "message": f"Failed to save memory to database vault."}