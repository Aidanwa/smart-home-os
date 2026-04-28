import json
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from typing import Any, List

from core.mqtt_bus import AsyncMqttBus
from api.dependencies import get_mqtt_bus
from api.models import (
    DeviceListResponse, DeviceStateResponse, DeviceSetRequest, GroupInfo,
    BridgeHealthResponse, BridgeInfoResponse, PermitJoinRequest, GroupCreateRequest, 
    GroupMemberRequest,
)
from api.auth import verify_api_key

router = APIRouter(prefix="/api", tags=["Devices"], dependencies=[Depends(verify_api_key)])

# ====================================================================================
# Device Routes
# ====================================================================================

@router.get("/devices", response_model=DeviceListResponse, response_model_exclude_none=True)
async def list_devices(bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    """
    Get the current state of all devices from the Redis Digital Twin.
    """
    try:
        # Pull the raw dictionary from Redis
        raw_twin = await bus.get_digital_twin()
        
        return DeviceListResponse(
            count=len(raw_twin),
            # Pydantic will automatically filter the raw_twin dictionary 
            # through our DeviceState model, dropping all the messy Z2M noise!
            devices=raw_twin 
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=f"Failed to read Digital Twin: {str(e)}"
        )

@router.get("/devices/{friendly_name}", response_model=DeviceStateResponse, response_model_exclude_none=True)
async def get_device_state(friendly_name: str, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    """
    Get the current state of a single specific device.
    """
    try:
        # HGET just pulls the single JSON string for this specific device
        raw_state_str = await bus.redis.hget("gateway:digital_twin", friendly_name)
        
        if not raw_state_str:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail=f"Device '{friendly_name}' not found in Digital Twin."
            )
            
        raw_state = json.loads(raw_state_str)
        
        return DeviceStateResponse(
            friendly_name=friendly_name,
            **raw_state
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=f"Failed to read device state: {str(e)}"
        )
    
@router.post("/devices/{friendly_name}/set")
async def set_device_state(
    friendly_name: str, 
    request: DeviceSetRequest, 
    bus=Depends(get_mqtt_bus)
):
    """
    Publish a state change to a device and await hardware confirmation.
    """
    # Convert model to dict, removing None values to keep MQTT payloads lean
    payload = request.model_dump(exclude_unset=True)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="No valid state fields provided"
        )

    topic = f"zigbee2mqtt/{friendly_name}/set"
    
    try:
        # This awaits the Zigbee network's confirmation via the Future-backed RPC system.
        # It relies on the hardware successfully publishing a new state.
        result = await bus.rpc(topic, payload)
        
        return {
            "status": "success",
            "device": friendly_name,
            "confirmed_state": result
        }
    except TimeoutError as e:
        # Catch the specific TimeoutError raised by bus.rpc() 
        # and translate it to a 504 Gateway Timeout
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Device '{friendly_name}' did not confirm the state change in time. It might be offline or unresponsive."
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while setting device state: {str(e)}"
        )
    
# ====================================================================================
# Group Routes
# ====================================================================================

@router.post("/groups")
async def create_group(request: GroupCreateRequest, bus=Depends(get_mqtt_bus)):
    """
    Create a new Zigbee group and initialize it with members.
    """
    try:
        # 1. Create the Group
        res = await bus.rpc("zigbee2mqtt/bridge/request/group/add", {"friendly_name": request.friendly_name})
        
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Unknown error creating group"))

        return {
            "status": "success",
            "group": request.friendly_name,
        }
        
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout during group creation.")

@router.post("/groups/{group_name}/members")
async def add_group_member(group_name: str, request: GroupMemberRequest, bus=Depends(get_mqtt_bus)):
    """Add a single device to an existing group."""
    try:
        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/members/add", 
            {"group": group_name, "device": request.device}
        )
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to add member"))
            
        return {"status": "success", "message": f"Added {request.device} to {group_name}"}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout.")

@router.delete("/groups/{group_name}/members/{device_name}")
async def remove_group_member(group_name: str, device_name: str, bus=Depends(get_mqtt_bus)):
    """Remove a single device from an existing group."""
    try:
        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/members/remove", 
            {"group": group_name, "device": device_name}
        )
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to remove member"))
            
        return {"status": "success", "message": f"Removed {device_name} from {group_name}"}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout.")
    
@router.get("/groups", response_model=List[GroupInfo])
async def list_groups(bus=Depends(get_mqtt_bus)):
    """
    Query the Zigbee groups from the Redis Digital Twin.
    Z2M publishes this as a retained message on boot.
    """
    try:
        raw_groups = await bus.redis.get("gateway:groups")
        
        if not raw_groups:
            # If empty, either no groups exist or Z2M hasn't published them yet
            return []
            
        groups_data = json.loads(raw_groups)
        
        # Pydantic will automatically validate the raw Z2M array against your GroupInfo model list
        return groups_data
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch groups from Digital Twin: {str(e)}"
        )

@router.post("/groups/{friendly_name}/set")
async def set_group_state(
    friendly_name: str, 
    request: DeviceSetRequest, 
    bus=Depends(get_mqtt_bus)
):
    """
    Broadcast a state change to a Zigbee group.
    This is fire-and-forget; individual device updates will trickle into the Digital Twin.
    """
    payload = request.model_dump(exclude_unset=True)
    
    if not payload:
        raise HTTPException(status_code=400, detail="No valid state fields provided")

    topic = f"zigbee2mqtt/{friendly_name}/set"
    
    if not bus.client:
        raise HTTPException(status_code=503, detail="MQTT Bus is disconnected")
        
    try:
        # Direct publish. No RPC await. 
        await bus.client.publish(topic, json.dumps(payload))
        
        return {
            "status": "command_sent",
            "group": friendly_name,
            "message": "Group broadcast sent. Devices will update asynchronously."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to publish group command: {str(e)}"
        )
    
    
@router.post("/groups")
async def create_group(request: GroupCreateRequest, bus=Depends(get_mqtt_bus)):
    """
    Create a new Zigbee group on the network.
    The Bridge will automatically broadcast the updated group list to our Redis Digital Twin.
    """
    try:
        payload = {"friendly_name": request.friendly_name}
        
        # Publish to the Z2M bridge add group endpoint and await confirmation
        response = await bus.rpc("zigbee2mqtt/bridge/request/group/add", payload)
        
        if response.get("status") != "ok":
            # Z2M puts error reasons (like 'group already exists') in the 'error' field
            error_msg = response.get("error", "Unknown error")
            raise HTTPException(status_code=400, detail=f"Failed to create group: {error_msg}")
            
        return {
            "status": "success",
            "message": f"Group '{request.friendly_name}' created successfully.",
            "data": response.get("data", {})
        }
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Bridge did not respond to the group creation request in time."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.delete("/groups/{group_name}")
async def delete_group(group_name: str, bus=Depends(get_mqtt_bus)):
    """
    Delete a Zigbee group from the network.
    The Bridge will automatically broadcast the updated group list to Redis.
    """
    try:
        # Publish to the Z2M bridge remove group endpoint
        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/remove", 
            {"id": group_name}
        )
        
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to delete group"))
            
        return {"status": "success", "message": f"Group '{group_name}' deleted successfully."}
        
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout during group deletion.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ====================================================================================
# Bridge Routes
# ====================================================================================

@router.get("/bridge/info", response_model=BridgeInfoResponse)
async def get_bridge_info(bus=Depends(get_mqtt_bus)):
    """
    Get detailed information about the Zigbee network instantly from Redis.
    """
    try:
        raw_info = await bus.redis.get("gateway:bridge_info")
        
        if not raw_info:
            # If empty, the broker hasn't pushed the retained message yet
            raise HTTPException(status_code=503, detail="Bridge info is syncing, please try again in a moment.")
            
        return json.loads(raw_info)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read info from twin: {str(e)}")

    
@router.get("/bridge/health", response_model=BridgeHealthResponse)
async def get_bridge_health(bus=Depends(get_mqtt_bus)):
    """
    Check if the Zigbee2MQTT bridge is healthy and responding.
    """
    try:
        # Z2M health check requires an empty payload
        response = await bus.rpc("zigbee2mqtt/bridge/request/health_check", {})
        
        status = response.get("status", "unknown")
        data = response.get("data", {})
        
        return BridgeHealthResponse(
            healthy=data.get("healthy", False),
            status=status
        )
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Bridge did not respond to health check in time."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bridge/permit_join")
async def permit_join(request: PermitJoinRequest, bus=Depends(get_mqtt_bus)):
    """
    Enable or disable device pairing (permit join) on the network.
    """
    try:
        payload = request.model_dump(exclude_unset=True)
        
        # Override value to False if time is 0
        if payload.get("time") == 0:
            payload["value"] = False
            
        response = await bus.rpc("zigbee2mqtt/bridge/request/permit_join", payload)
        
        if response.get("status") != "ok":
            raise HTTPException(status_code=500, detail=f"Failed to set permit join: {response.get('error', 'Unknown error')}")
            
        return {
            "status": "success",
            "message": f"Permit join {'enabled' if payload['value'] else 'disabled'}.",
            "data": response.get("data", {})
        }
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Bridge did not respond to permit join request."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# ====================================================================================
# Websocket Routes
# ====================================================================================

# Create a separate router WITHOUT the verify_api_key dependency
ws_router = APIRouter(prefix="/api", tags=["Realtime"])

@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time stream of digital twin updates."""
    await websocket.accept()
    
    # Grab the bus directly from the application state to avoid dependency clashes
    bus = websocket.app.state.bus 
    queue = bus.subscribe()
    
    try:
        while True:
            msg = await queue.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        bus.unsubscribe(queue)
