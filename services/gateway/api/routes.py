import json
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Any

from core.mqtt_bus import AsyncMqttBus
from api.dependencies import get_mqtt_bus
from api.models import DeviceListResponse, DeviceStateResponse, DeviceState
from api.auth import verify_api_key

router = APIRouter(prefix="/api", tags=["Devices"], dependencies=[Depends(verify_api_key)])

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