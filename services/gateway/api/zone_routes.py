import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

# Adjust these imports based on your actual structure
from shared.database.core import get_db
from shared.database.models import LogicalZone, DevicePlacement
from api.auth import get_current_user
from core.rooms import all_rooms
from .models import ZoneCreate, ZoneRename, ZoneUpdateLayout, ZoneResponse, BatchPlacementUpdate, PlacementResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/zones", tags=["Spatial Layout"], dependencies=[Depends(get_current_user)])


async def _rooms_changed(request: Request):
    """Rooms or placements changed: recompute room occupancy (core/rooms.py). Never fails the request."""
    rooms = getattr(request.app.state, "rooms", None)
    if rooms is None:
        return
    try:
        await rooms.reload()
    except Exception:
        logger.exception("Room occupancy reload failed")


@router.get("/occupancy")
async def room_occupancy(request: Request):
    """{room id: {name, floor, occupied (null = no presence/motion sensor), since, sensors}}."""
    return await all_rooms(request.app.state.bus.redis)

@router.get("", response_model=list[ZoneResponse])
async def get_floor_zones(floor_level: int = 1, db: AsyncSession = Depends(get_db)):
    """Fetch all rooms mapped to a specific floor."""
    result = await db.execute(
        select(LogicalZone).where(LogicalZone.floor_level == floor_level)
    )
    return result.scalars().all()

@router.post("", response_model=ZoneResponse)
async def create_zone(zone_in: ZoneCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """Create a new room canvas."""
    new_zone = LogicalZone(**zone_in.model_dump())
    db.add(new_zone)
    try:
        await db.commit()
        await db.refresh(new_zone)
        await _rooms_changed(request)
        return new_zone
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Zone creation failed. Name may already exist.")

@router.patch("/{zone_id}", response_model=ZoneResponse)
async def rename_zone(zone_id: UUID, payload: ZoneRename, request: Request, db: AsyncSession = Depends(get_db)):
    """Rename an existing room."""
    result = await db.execute(select(LogicalZone).where(LogicalZone.id == zone_id))
    zone = result.scalar_one_or_none()

    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Update the zone name
    zone.name = payload.name.strip()
    if payload.color:
        zone.color = payload.color.strip()

    await db.commit()
    await db.refresh(zone)
    await _rooms_changed(request)
    return zone

@router.put("/{zone_id}/layout", response_model=ZoneResponse)
async def update_zone_layout(zone_id: UUID, layout: ZoneUpdateLayout, db: AsyncSession = Depends(get_db)):
    """Update the size and position of a room on the macro floor plan."""
    result = await db.execute(select(LogicalZone).where(LogicalZone.id == zone_id))
    zone = result.scalar_one_or_none()
    
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Update spatial properties
    zone.width = layout.width
    zone.height = layout.height
    zone.pos_x = layout.pos_x
    zone.pos_y = layout.pos_y

    await db.commit()
    await db.refresh(zone)
    return zone

@router.put("/placements/batch")
async def batch_update_placements(batch: BatchPlacementUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    CRITICAL ENDPOINT: Accepts a mass payload of device coordinates when a user 
    hits 'Save Layout' after dragging multiple devices around a room.
    """
    try:
        for placement in batch.placements:
            # Check if this physical device already has a placement record
            db_placement = await db.get(DevicePlacement, placement.ieee_address)
            
            if db_placement:
                # Update existing coordinates
                db_placement.zone_id = placement.zone_id
                db_placement.pos_x = placement.pos_x
                db_placement.pos_y = placement.pos_y
            else:
                # Upsert: Device exists in mesh/Redis, but hasn't been placed yet
                new_placement = DevicePlacement(**placement.model_dump())
                db.add(new_placement)

        # Execute everything as one lightning-fast transaction
        await db.commit()
        await _rooms_changed(request)
        return {"status": "success", "updated_count": len(batch.placements)}
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")
    
@router.get("/placements", response_model=list[PlacementResponse])
async def get_all_placements(db: AsyncSession = Depends(get_db)):
    """
    Fetch all physical device spatial mappings.
    The frontend uses this to cross-reference the Redis Digital Twin 
    and determine which devices are unplaced vs. placed in specific rooms.
    """
    result = await db.execute(select(DevicePlacement))
    return result.scalars().all()
    
@router.delete("/{zone_id}")
async def delete_zone(
    zone_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LogicalZone).where(LogicalZone.id == zone_id)
    )

    zone = result.scalar_one_or_none()

    if not zone:
        raise HTTPException(
            status_code=404,
            detail="Zone not found"
        )

    await db.delete(zone)
    await db.commit()
    await _rooms_changed(request)

    return {"status": "success"}