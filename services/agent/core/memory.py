import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any

class MemoryManager:
    def __init__(self, profile_dir: str = "/app/data/profiles"):
        self.profile_dir = profile_dir
        os.makedirs(self.profile_dir, exist_ok=True)
        
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


    def pretty_print_history(self, user_id: str):
        """
        Prints a nicely formatted, human-readable view of a user's 
        short-term memory for debugging purposes.
        """
        history = self._short_term.get(user_id, [])
        
        print(f"\n{'='*60}")
        print(f"SHORT-TERM MEMORY: {user_id}")
        print(f"Total Messages: {len(history)}")
        print(f"{'='*60}")

        if not history:
            print("  (Empty)\n")
            return

        for i, item in enumerate(history):
            timestamp = item["timestamp"].strftime("%H:%M:%S")
            message = item["message"]
            
            # Extract role for quick scanning, default to UNKNOWN
            role = message.get("role", "FUNCTION").upper()
            
            print(f"\n[{i+1}] {timestamp} | {role}")
            print("-" * 60)
            
            # If it's a standard text message, pull 'content' out for easy reading
            if "content" in message and isinstance(message["content"], str):
                print(message["content"])
                
                # Print any leftover keys (like tool_calls, name, etc.) as indented JSON
                other_keys = {k: v for k, v in message.items() if k != "content" and v}
                if other_keys:
                    print(f"\n[Metadata]:")
                    # default=str prevents crashes if there are nested datetimes or weird objects
                    print(json.dumps(other_keys, indent=2, default=str))
            else:
                # If there is no string content (e.g., pure tool calls), print the whole thing
                print(json.dumps(message, indent=2, default=str))
                
        print(f"\n{'='*60}\n")


    # --- Long-Term Memory (Persistent Text File) ---
    
    def get_user_profile(self, user_id: str) -> str:
        """Reads the user's persistent memory file."""
        file_path = os.path.join(self.profile_dir, f"{user_id}.txt")
        if not os.path.exists(file_path):
            return "No specific preferences or memories recorded yet."
            
        with open(file_path, "r") as f:
            return f.read()

    # NOTE: We make this async so it can be called as an LLM Tool!
    async def update_user_profile(self, user_id: str, new_content: str) -> Dict[str, Any]:
        """Tool: Overwrites the user's persistent memory file with new facts."""
        file_path = os.path.join(self.profile_dir, f"{user_id}.txt")
        try:
            with open(file_path, "w") as f:
                f.write(new_content)
            return {"status": "success", "message": "Memory successfully updated."}
        except Exception as e:
            return {"status": "error", "message": f"Failed to save memory: {str(e)}"}