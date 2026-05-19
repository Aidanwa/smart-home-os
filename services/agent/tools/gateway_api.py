import logging
import os
import httpx
from typing import Dict, Any

logger = logging.getLogger(__name__)

api_key = os.getenv("GATEWAY_API_KEY")

class GatewayClient:
    """
    The HTTP client responsible for communicating with the main Gateway Service.
    Acts as the strict boundary between the Agent's reasoning and the home's physical state.
    """
    def __init__(self, base_url: str):
        """
        Initialize with the internal Docker network URL of the Gateway.
        e.g., "http://gateway:8000"
        """
        self.base_url = base_url.rstrip("/")
        # We use a single AsyncClient session for connection pooling and speed
        self.client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)

    async def close(self):
        """Gracefully close the HTTP connection pool."""
        await self.client.aclose()

    # ---------------------------------------------------------
    # Core Context Route
    # ---------------------------------------------------------
    async def get_filtered_context(self, user_id: str) -> Dict[str, Any]:
        """
        Fetches the current state of the home. 
        Note: Currently fetches the global state via /api/devices. 
        RBAC filtering based on user_id will be implemented in the future.
        Returns data in string format for easy injection into LLM prompts.
        """
        try:
            # Hitting the existing Phase 1 route to get the full Digital Twin
            response = await self.client.get("/api/devices", headers={"X-API-Key": api_key})
            response.raise_for_status()
            
            # The Gateway returns {"count": X, "devices": {...}}. We just need the devices.
            data = response.json()
            devices = data.get("devices", {})

            formatted_lines = []

            for ieee, attributes in devices.items():
                # Extract the friendly name
                friendly_name = attributes.get('friendly_name', 'UnknownDevice')
                
                # Gather all other attributes, excluding 'ieee_address' and 'friendly_name'
                attr_list = [
                    f"{k}: {v}" for k, v in attributes.items() 
                    if k not in ('ieee_address', 'linkquality', 'friendly_name')
                ]
                
                # Join attributes with a comma and format the final string
                attributes_string = ", ".join(attr_list)
                formatted_lines.append(f"{friendly_name}: {attributes_string}")

            # Join all lines with a newline character
            final_output = "\n".join(formatted_lines)

            return final_output
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Gateway returned HTTP error {e.response.status_code}: {e.response.text}")
            raise Exception("Failed to fetch context from Gateway.")
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to Gateway: {str(e)}")
            raise Exception("Gateway service is unreachable.")

    # ---------------------------------------------------------
    # LLM Tool Executions
    # ---------------------------------------------------------
    # The names of these methods MUST match the tool names provided in the LLM's JSON schema!
    
    async def set_device_state(self, user_id: str, device_id: str, state_changes: Dict[str, Any]) -> Dict[str, Any]:
        """
        Tool: Changes the state of a specific Zigbee device.
        """
        logger.info(f"Agent attempting to set {device_id} to {state_changes}")
        
        try:
            # The Gateway POST route you already built in Phase 1
            response = await self.client.post(
                f"/api/devices/{device_id}/set",
                json=state_changes,
                headers={"X-API-Key": api_key}
            )
            response.raise_for_status()
            return {"status": "success", "message": f"Successfully updated {device_id}.", "data": response.json()}
            
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"Gateway rejected the command: {e.response.text}"}
            
        except Exception as e:
            return {"status": "error", "message": f"Network error communicating with the Gateway: {str(e)}"}
            
    async def rename_group(self, user_id: str, group_name: str, new_name: str) -> Dict[str, Any]:
        """
        Tool: Renames a Zigbee group.
        """
        try:
            response = await self.client.put(
                f"/api/groups/{group_name}/rename",
                params={"new_name": new_name}
            )
            response.raise_for_status()
            return {"status": "success", "message": f"Renamed group {group_name} to {new_name}."}
        except Exception as e:
            return {"status": "error", "message": str(e)}