from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class DeviceState(BaseModel):
    """
    Cleaned device state. 
    ConfigDict(extra='ignore') strips out messy Zigbee link qualities and metadata,
    ignoring any fields not explicitly defined here. We can add common attributes as needed.
    """
    model_config = ConfigDict(extra='ignore')

    # General Attributes
    linkquality: Optional[int] = None
    ieee_address: Optional[str] = None
    friendly_name: Optional[str] = None
    
    # Lights / Switches
    state: Optional[str] = None
    brightness: Optional[int] = None
    color_temp: Optional[int] = None
    color: Optional[Dict[str, Any]] = None  # e.g. {"x": 0.5, "y": 0.5}
    
    # Sensors
    temperature: Optional[float] = None
    temperature_units: Optional[str] = None
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

class GroupMember(BaseModel):
    """Represents a device endpoint that belongs to a group."""
    endpoint: int
    ieee_address: str
    
    model_config = ConfigDict(extra="ignore")

class GroupInfo(BaseModel):
    """Information about a specific Zigbee group."""
    id: int
    friendly_name: str
    members: List[GroupMember] = Field(default_factory=list)
    
    model_config = ConfigDict(extra="ignore")

class BridgeHealthResponse(BaseModel):
    healthy: bool
    status: str
    
    model_config = ConfigDict(extra="ignore")

class BridgeInfoResponse(BaseModel):
    version: str
    commit: Optional[str] = None
    coordinator: Optional[dict] = None
    network: Optional[dict] = None
    
    model_config = ConfigDict(extra="ignore")

class PermitJoinRequest(BaseModel):
    # Time in seconds to allow joining. Z2M max is 254. 
    # Setting time to 0 disables joining.
    value: bool = True
    time: Optional[int] = Field(254, ge=0, le=254)
    
    model_config = ConfigDict(extra="ignore")

class GroupCreateRequest(BaseModel):
    friendly_name: str
        
    model_config = ConfigDict(extra="ignore")

class GroupMemberRequest(BaseModel):
    device: str
    
    model_config = ConfigDict(extra="ignore")

class RenameRequest(BaseModel):
    new_name: str
    
    model_config = ConfigDict(extra="ignore")