import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from typing import Any, List
import asyncio
import httpx
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

# Assuming standard shared import convention for models and dependencies
from shared.database.models import DevicePlacement
from shared.database.core import get_db

from core.mqtt_bus import AsyncMqttBus
from core import device_control
from api.dependencies import get_mqtt_bus
from api.models import (
    DeviceListResponse, DeviceStateResponse, DeviceSetRequest, GroupInfo,
    BridgeHealthResponse, BridgeInfoResponse, PermitJoinRequest, GroupCreateRequest, 
    GroupMemberRequest, RenameRequest,
)
from api.auth import get_current_user, get_ws_authenticated_user

logger = logging.getLogger(__name__)

# App-level keepalive for browser WebSockets (/api/ws and the agent chat proxy). Browsers can't
# see protocol pings, so the frontend watches for this message and reconnects after ~60 s of
# silence (frontend/src/lib/reconnectingSocket.ts). Keep the literal in sync with KEEPALIVE there.
WS_KEEPALIVE_S = 25
WS_KEEPALIVE_MSG = '{"type":"ping"}'

# Change this line in services/gateway/api/routes.py
router = APIRouter(prefix="/api", tags=["Devices"], dependencies=[Depends(get_current_user)])

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

@router.get("/devices/{device_id}", response_model=DeviceStateResponse, response_model_exclude_none=True)
async def get_device_state(device_id: str, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    """
    Get the current state of a single specific device using either its UUID or friendly_name.
    """
    try:
        # If passed a friendly_name, convert to IEEE address
        target_ieee = bus._device_registry.get(device_id, device_id)

        raw_state_str = await bus.redis.hget("gateway:digital_twin", target_ieee)
        
        if not raw_state_str:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail=f"Device '{device_id}' not found in Digital Twin."
            )
            
        raw_state = json.loads(raw_state_str)
        friendly_name = raw_state.get("friendly_name", device_id)
        
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


@router.get("/devices/{device_id}/info")
async def get_device_info(device_id: str, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    """Identity, firmware and pairing health for one device (IEEE or friendly_name),
    kept from Z2M's retained bridge/devices by the bus."""
    raw = await bus.redis.get("gateway:device_meta")
    if not raw:
        raise HTTPException(status_code=503, detail="Device details are still syncing from the hub.")
    info = json.loads(raw).get(bus._device_registry.get(device_id, device_id))
    if info is None:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found.")
    return info


@router.post("/devices/{device_id}/set")
async def set_device_state(
    device_id: str, 
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

    try:
        # Awaits the device's next state publish; ON/OFF requests are checked against it.
        result = await device_control.set_device(bus, device_id, payload)

        return {
            "status": "success",
            "device": device_id,
            "confirmed_state": result
        }
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Device '{device_id}' did not confirm the state change in time. It might be offline or unresponsive."
        )
    except device_control.DeviceStateMismatch as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
    except device_control.MqttDisconnected as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while setting device state: {str(e)}"
        )

@router.delete("/devices/{device_id}")
async def delete_device(
    device_id: str, 
    bus: AsyncMqttBus = Depends(get_mqtt_bus),
    db: AsyncSession = Depends(get_db)
):
    try:
        # TRANSLATION STEP (Map friendly_name -> IEEE address if needed)
        target_ieee = bus._device_registry.get(device_id, device_id)

        # 1. Fetch the state from Redis using target_ieee
        raw_state_str = await bus.redis.hget("gateway:digital_twin", target_ieee)
        
        if not raw_state_str:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device '{device_id}' not found."
            )
            
        state = json.loads(raw_state_str)
        friendly_name = state.get("friendly_name")
        
        if not friendly_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not resolve friendly_name for exclusion."
            )

        # 2. Issue the RPC call to Zigbee2MQTT bridge to remove the device
        payload = {"id": friendly_name, "force": False} 
        res = await bus.rpc(f"{bus.z2m_base}/bridge/request/device/remove", payload)

        if res.get("status") != "ok":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=res.get("error", "Bridge failed to remove device.")
            )

        # 3. Clean up the Relational DB Schema (Spatial UI placement data)
        # Using SQLAlchemy 2.0 1-step execution expression
        await db.execute(
            delete(DevicePlacement).where(DevicePlacement.ieee_address == target_ieee)
        )
        await db.commit()

        # 4. Wipe the device from digital twin and broadcast the deletion to subscribers
        await bus.redis.hdel("gateway:digital_twin", target_ieee)
        
        bus.broadcast({"type": "device_delete", "device": target_ieee})

        return {
            "status": "success", 
            "message": f"Device '{friendly_name}' ({device_id}) successfully purged from network and spatial configuration."
        }

    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Bridge timeout while attempting to remove device."
        )
    except HTTPException:
        # Re-raise explicit HTTP exceptions to bypass generic handling
        raise
    except Exception as e:
        # Roll back relational state if an unexpected crash occurs after DB operation
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during device deletion: {str(e)}"
        )
    
@router.put("/device/{device_id}/rename")
async def rename_device(device_id: str, request: RenameRequest, bus=Depends(get_mqtt_bus)):
    try:
        if any(char in request.new_name for char in ['+', '#']):
            raise HTTPException(status_code=400, detail="Device names cannot contain MQTT wildcard characters '+' or '#'")
            
        # TRANSLATION STEP
        target_ieee = bus._device_registry.get(device_id, device_id)

        # 1. Look up the CURRENT friendly_name to tell Z2M what to rename
        raw_state_str = await bus.redis.hget("gateway:digital_twin", target_ieee)
        friendly_name = device_id
        if raw_state_str:
            state_obj = json.loads(raw_state_str)
            friendly_name = state_obj.get("friendly_name", device_id)

        payload = {"from": friendly_name, "to": request.new_name}
        
        # Publish to the Z2M bridge rename device endpoint
        res = await bus.rpc("zigbee2mqtt/bridge/request/device/rename", payload)
        
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to rename device"))
            
        return {"status": "success", "message": f"Device '{friendly_name}' renamed to '{request.new_name}' successfully."}
        
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout during device renaming.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Z2M answers an OTA request only when the update has finished (often 10-30 minutes), so the
# route starts it and returns; progress arrives as the device's `update` state, and the outcome
# is pushed to the browsers as {type: "ota_result"}.
OTA_TIMEOUT_S = 2 * 60 * 60
_ota_tasks: dict[str, asyncio.Task] = {}


@router.post("/devices/{device_id}/firmware/update", status_code=status.HTTP_202_ACCEPTED)
async def update_firmware(device_id: str, bus=Depends(get_mqtt_bus)):
    target_ieee = bus._device_registry.get(device_id, device_id)
    raw = await bus.redis.hget("gateway:digital_twin", target_ieee)
    if not raw:
        raise HTTPException(status_code=404, detail="Device not found.")
    state = json.loads(raw)
    friendly_name = state.get("friendly_name", device_id)
    update = state.get("update") or {}
    if update.get("state") in ("updating", "scheduled") or (
        target_ieee in _ota_tasks and not _ota_tasks[target_ieee].done()
    ):
        raise HTTPException(status_code=409, detail="An update is already in progress for this device.")
    if update.get("state") != "available":
        raise HTTPException(status_code=400, detail="No firmware update is available for this device.")

    async def run():
        try:
            res = await bus.rpc(
                f"{bus.z2m_base}/bridge/request/device/ota_update/update", {"id": friendly_name}, timeout=OTA_TIMEOUT_S
            )
            ok = res.get("status") == "ok"
            error = None if ok else res.get("error", "Update failed")
        except TimeoutError:
            ok, error = False, "No answer from Zigbee2MQTT after 2 hours"
        except Exception as e:  # keep the task from dying silently
            ok, error = False, str(e)
        logger.info("OTA update for %s finished: ok=%s error=%s", friendly_name, ok, error)
        bus.broadcast({"type": "ota_result", "device": target_ieee, "friendly_name": friendly_name, "ok": ok, "error": error})
        _ota_tasks.pop(target_ieee, None)

    _ota_tasks[target_ieee] = asyncio.create_task(run())
    return {"status": "started", "message": f"Firmware update started for '{friendly_name}'."}

# ====================================================================================
# Group Routes
# ====================================================================================

@router.post("/groups")
async def create_group(request: GroupCreateRequest, bus=Depends(get_mqtt_bus)):
    """
    Create a new Zigbee group on the network.
    """
    try:
        payload = {"friendly_name": request.friendly_name}
        
        # Publish to the Z2M bridge add group endpoint and await confirmation
        response = await bus.rpc("zigbee2mqtt/bridge/request/group/add", payload)
        
        if response.get("status") != "ok":
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

@router.post("/groups/{group_name}/members")
async def add_group_member(group_name: str, request: GroupMemberRequest, bus=Depends(get_mqtt_bus)):
    """Add a single device to an existing group."""
    try:
        raw_state_str = await bus.redis.hget("gateway:digital_twin", request.device)
        device_ref = request.device
        ieee_address = request.device if request.device.startswith("0x") else ""
        
        if raw_state_str:
            state_obj = json.loads(raw_state_str)
            device_ref = state_obj.get("friendly_name", request.device)
            ieee_address = state_obj.get("ieee_address", ieee_address)

        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/members/add", 
            {"group": group_name, "device": device_ref}
        )
        
        # Track if we need to force a manual sync because of the Z2M database glitch
        should_manually_sync = False

        if res.get("status") != "ok":
            error_msg = res.get("error", "")
            if "DatabaseEntry with ID" in error_msg and "does not exist" in error_msg:
                should_manually_sync = True
            else:
                raise HTTPException(status_code=400, detail=error_msg or "Failed to add member")

        # --- DIGITAL TWIN COHESION ENGINE ---
        # Fetch what we currently have cached for groups
        raw_groups = await bus.redis.get("gateway:groups")
        if raw_groups:
            groups_list = json.loads(raw_groups)
            for group in groups_list:
                if group.get("friendly_name") == group_name:
                    # Check if the device is already in the list to avoid duplicates
                    exists = any(m.get("ieee_address") == ieee_address or m.get("name") == device_ref for m in group.get("members", []))
                    if not exists:
                        group.setdefault("members", []).append({
                            "ieee_address": ieee_address,
                            "endpoint": 1,
                            "name": device_ref
                        })
            
            # Save the updated group structure back to Redis
            await bus.redis.set("gateway:groups", json.dumps(groups_list))

        return {"status": "success", "message": f"Added {device_ref} to {group_name}"}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout.")


@router.delete("/groups/{group_name}/members/{device_id}")
async def remove_group_member(group_name: str, device_id: str, bus=Depends(get_mqtt_bus)):
    """Remove a single device from an existing group."""
    try:
        raw_state_str = await bus.redis.hget("gateway:digital_twin", device_id)
        device_ref = device_id
        ieee_address = device_id if device_id.startswith("0x") else ""
        
        if raw_state_str:
            state_obj = json.loads(raw_state_str)
            device_ref = state_obj.get("friendly_name", device_id)
            ieee_address = state_obj.get("ieee_address", ieee_address)

        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/members/remove", 
            {"group": group_name, "device": device_ref}
        )
        
        if res.get("status") != "ok":
            error_msg = res.get("error", "")
            if "DatabaseEntry with ID" in error_msg and "does not exist" in error_msg:
                pass
            else:
                raise HTTPException(status_code=400, detail=error_msg or "Failed to remove member")

        # --- DIGITAL TWIN COHESION ENGINE ---
        raw_groups = await bus.redis.get("gateway:groups")
        if raw_groups:
            groups_list = json.loads(raw_groups)
            for group in groups_list:
                if group.get("friendly_name") == group_name:
                    group["members"] = [
                        m for m in group.get("members", [])
                        if m.get("ieee_address") != ieee_address and m.get("name") != device_ref
                    ]
            
            await bus.redis.set("gateway:groups", json.dumps(groups_list))
            
        return {"status": "success", "message": f"Removed {device_ref} from {group_name}"}
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

    try:
        # Direct publish. No RPC await.
        await device_control.set_group(bus, friendly_name, payload)

        return {
            "status": "command_sent",
            "group": friendly_name,
            "message": "Group broadcast sent. Devices will update asynchronously."
        }
    except device_control.MqttDisconnected as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to publish group command: {str(e)}"
        )
    
@router.delete("/groups/{group_name}")
async def delete_group(group_name: str, bus=Depends(get_mqtt_bus)):
    """
    Delete a Zigbee group from the network.
    Workaround: Z2M fails to delete populated groups cleanly. 
    We must iterate through the Digital Twin cache, remove all members individually, 
    and then destroy the group shell.
    """
    try:
        # 1. Fetch current groups from the Digital Twin
        raw_groups = await bus.redis.get("gateway:groups")
        groups_list = []
        
        if raw_groups:
            groups_list = json.loads(raw_groups)
            # Find the specific group we are trying to delete
            target_group = next((g for g in groups_list if g.get("friendly_name") == group_name), None)
            
            # 2. If the group has members, evict them one by one
            if target_group and target_group.get("members"):
                for member in target_group["members"]:
                    device_ref = member.get("name")
                    if not device_ref:
                        continue
                        
                    # Fire RPC to remove this specific device from the group
                    # We don't strictly check the response here, we just need to forcefully evict
                    await bus.rpc(
                        "zigbee2mqtt/bridge/request/group/members/remove", 
                        {"group": group_name, "device": device_ref}
                    )

        # 3. Now that the group is guaranteed empty, delete the group itself
        res = await bus.rpc(
            "zigbee2mqtt/bridge/request/group/remove", 
            {"id": group_name}
        )
        
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to delete empty group"))

        # 4. Digital Twin Cohesion: Prune the deleted group from Redis so the UI instantly updates
        if raw_groups:
            updated_groups = [g for g in groups_list if g.get("friendly_name") != group_name]
            await bus.redis.set("gateway:groups", json.dumps(updated_groups))
            
        return {"status": "success", "message": f"Group '{group_name}' completely emptied and deleted."}
        
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout during group deletion.")
    except HTTPException:
        raise  # Pass through known HTTP exceptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.put("/groups/{group_name}/rename")
async def rename_group(group_name: str, request: RenameRequest, bus=Depends(get_mqtt_bus)
):
    """
    Rename a Zigbee group on the network.
    The Bridge will automatically broadcast the updated group list to Redis.
    """
    try:
        if any(char in request.new_name for char in ['+', '#']):
            raise HTTPException(status_code=400, detail="Device names cannot contain MQTT wildcard characters '+' or '#'")
        payload = {"from": group_name, "to": request.new_name}
        # Publish to the Z2M bridge rename group endpoint
        res = await bus.rpc("zigbee2mqtt/bridge/request/group/rename", payload)
        
        if res.get("status") != "ok":
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to rename group"))
            
        return {"status": "success", "message": f"Group '{group_name}' renamed to '{request.new_name}' successfully."}
        
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Bridge timeout during group renaming.")
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


@router.get("/system/status")
async def get_system_status(bus=Depends(get_mqtt_bus)):
    """
    One check for the dashboard's status dot: is Zigbee answering, and is the assistant up?
    zigbee: ok | unhealthy (Z2M says so) | no_response (Z2M or the MQTT broker is down)
    agent:  ok | down (e.g. the ~40 s Whisper load after a deploy)
    """
    async def zigbee() -> str:
        try:
            res = await bus.rpc("zigbee2mqtt/bridge/request/health_check", {})
            return "ok" if (res.get("data") or {}).get("healthy") else "unhealthy"
        except Exception:
            return "no_response"

    async def agent() -> str:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                return "ok" if (await client.get("http://agent:8001/")).status_code == 200 else "down"
        except Exception:
            return "down"

    z, a = await asyncio.gather(zigbee(), agent())
    return {"zigbee": z, "agent": a}


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
    """Real-time stream of digital twin updates protected by HttpOnly Session context."""
    await websocket.accept()
    
    # 1. Execute initial handshake authentication via ambient cookie extraction
    user = await get_ws_authenticated_user(websocket)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
        
    bus = websocket.app.state.bus
    queue = bus.subscribe()
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=WS_KEEPALIVE_S)
            except asyncio.TimeoutError:
                # Quiet house: send a keepalive so the browser can tell a live socket from a
                # half-open one (phone slept, network changed) and reconnect. A failed send
                # here also drops a dead client's subscriber queue.
                await websocket.send_text(WS_KEEPALIVE_MSG)
                continue
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    finally:
        bus.unsubscribe(queue)


