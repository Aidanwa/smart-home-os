# services/agent/tools/gateway_api.py
import logging
import os
import httpx
import jwt
from datetime import datetime, timedelta, timezone
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Import the identical shared secret utilized by the gateway and routes.py
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "7b9d8df2ac3ce72b8d0093cf1b988fce899ea298b11119fcd5c95279da7311ef")
ALGORITHM = "HS256"

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

    def _mint_user_context_cookie(self, user_id: str) -> Dict[str, str]:
        """
        Dynamically generates a short-lived cryptographic token for the target user.
        This allows the Agent to 'impersonate' the user when hitting the Gateway,
        ensuring the Gateway's native RBAC/identity middleware accepts the request.
        """
        expire = datetime.now(timezone.utc) + timedelta(minutes=5)
        payload = {
            "sub": str(user_id),
            "exp": expire
        }
        token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)
        
        # Return in the exact format httpx expects for cookie injection
        return {"access_token": token}

    # ---------------------------------------------------------
    # Core Context Route
    # ---------------------------------------------------------
    async def get_filtered_context(self, user_id: str) -> str:
        """
        Fetches the current state of the home using an identity-bound request.
        """
        try:
            # FIX: Inject the forged identity cookie into the request
            response = await self.client.get(
                "/api/devices",
                cookies=self._mint_user_context_cookie(user_id)
            )
            response.raise_for_status()
            
            data = response.json()
            devices = data.get("devices", {})

            formatted_lines = []

            for ieee, attributes in devices.items():
                friendly_name = attributes.get('friendly_name', 'UnknownDevice')
                
                attr_list = [
                    f"{k}: {v}" for k, v in attributes.items() 
                    if k not in ('ieee_address', 'linkquality', 'friendly_name')
                ]
                
                attributes_string = ", ".join(attr_list)
                formatted_lines.append(f"{friendly_name}: {attributes_string}")

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
    async def set_device_state(self, user_id: str, id: str, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Tool: Changes the state of a specific Zigbee device on behalf of the user.
        """
        logger.info(f"Agent attempting to set {id} to {state} for user {user_id}")
        
        try:
            # FIX: Attach the delegated user cookie to authorize the write operation
            response = await self.client.post(
                f"/api/devices/{id}/set",
                json=state,
                cookies=self._mint_user_context_cookie(user_id)
            )
            response.raise_for_status()
            return {"status": "success", "message": f"Successfully updated {id}.", "data": response.json()}
            
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"Gateway rejected the command: {e.response.text}"}
        except Exception as e:
            return {"status": "error", "message": f"Network error communicating with the Gateway: {str(e)}"}
            
    async def rename_group(self, user_id: str, group_name: str, new_name: str) -> Dict[str, Any]:
        """
        Tool: Renames a Zigbee group on behalf of the user.
        """
        try:
            response = await self.client.put(
                f"/api/groups/{group_name}/rename",
                params={"new_name": new_name},
                cookies=self._mint_user_context_cookie(user_id)
            )
            response.raise_for_status()
            return {"status": "success", "message": f"Renamed group {group_name} to {new_name}."}
        except Exception as e:
            return {"status": "error", "message": str(e)}