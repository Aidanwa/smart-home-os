from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from uuid import UUID

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

class HomeBase(BaseModel):
    nickname: str = Field(default="My Smart Home", max_length=100)
    address: Optional[str] = None
    timezone: str = Field(default="UTC", max_length=50)
    # Make lat/lon optional so the user only has to provide the address!
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    bottom_floor: int = Field(default=1, description="Lowest floor number (e.g., -1 for basement)")
    top_floor: int = Field(default=1, description="Highest floor number")

    @model_validator(mode="after")
    def validate_floors(self) -> "HomeBase":
        if self.bottom_floor > self.top_floor:
            raise ValueError("bottom_floor cannot be greater than top_floor")
        return self

class HomeUpdate(HomeBase):
    pass

class HomeResponse(HomeBase):
    id: UUID
    weather_grid: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class ZoneBase(BaseModel):
    name: str
    zone_type: str = "room"
    floor_level: int = 1
    shape_type: str = "rectangle"
    width: float = Field(default=100.00, description="Relative width of the room")
    height: float = Field(default=100.00, description="Relative height of the room")
    pos_x: float = Field(default=0.00, description="Macro X position on floor plan")
    pos_y: float = Field(default=0.00, description="Macro Y position on floor plan")
    color: Optional[str] = Field(default="#64748b", description="Hex color code for the room")

class ZoneCreate(ZoneBase):
    pass

class ZoneUpdateLayout(BaseModel):
    width: float
    height: float
    pos_x: float
    pos_y: float

class ZoneResponse(ZoneBase):
    id: UUID
    display_order: int
    
    class Config:
        from_attributes = True

class PlacementUpdate(BaseModel):
    ieee_address: str
    zone_id: Optional[UUID] = None
    pos_x: float = Field(..., ge=0.0, le=100.0, description="Micro X percentage")
    pos_y: float = Field(..., ge=0.0, le=100.0, description="Micro Y percentage")

class BatchPlacementUpdate(BaseModel):
    placements: List[PlacementUpdate]

class ZoneRename(BaseModel):
    name: str
    color: Optional[str]

class PlacementResponse(BaseModel):
    ieee_address: str
    zone_id: Optional[UUID]
    pos_x: float
    pos_y: float
    pos_z: float

    class Config:
        from_attributes = True