from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class DeviceState(BaseModel):
    """
    Cleaned device state. 
    ConfigDict(extra='ignore') strips out messy Zigbee link qualities and metadata,
    ignoring any fields not explicitly defined here. We can add common attributes as needed.
    """
    model_config = ConfigDict(extra='ignore')
    
    # Lights / Switches
    state: Optional[str] = None
    brightness: Optional[int] = None
    color_temp: Optional[int] = None
    
    # Sensors
    temperature: Optional[float] = None
    temperature_units: Optional[str] = None
    humidity: Optional[float] = None
    battery: Optional[int] = None
    
    # Smart Plugs
    power: Optional[float] = None
    voltage: Optional[float] = None
    energy: Optional[float] = None

class DeviceStateResponse(DeviceState):
    """Adds the friendly_name to the state for individual device queries."""
    friendly_name: str

class DeviceListResponse(BaseModel):
    """Response model for the full home state."""
    count: int
    # A dictionary mapping friendly_name to its cleaned state
    devices: Dict[str, DeviceState]

class DeviceSetRequest(BaseModel):
    state: Optional[Literal["ON", "OFF", "TOGGLE"]] = None
    brightness: Optional[int] = Field(None, ge=0, le=254)
    color_temp: Optional[int] = Field(None, ge=150, le=500)
    transition: Optional[float] = Field(None, ge=0)

    model_config = ConfigDict(extra="ignore")

class RPCResponse(BaseModel):
    status: str
    transaction: str
    data: Optional[dict] = None