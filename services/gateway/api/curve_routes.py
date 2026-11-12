"""Day curves (/api/curves): the curves, which lights follow them, and each light's live status.

The controller (curves/controller.py, app.state.curves) does the work; every change here calls
its reload(). The editor's chart comes from /preview, computed with the home's sun times.
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from curves.compute import next_changes, samples, sun_times, target
from curves.schema import CurveSpec, MemberRequest, PreviewRequest, uses_sun
from shared.database.core import get_db
from shared.database.models import LightCurve, LightCurveMember

router = APIRouter(prefix="/api/curves", tags=["Day curves"], dependencies=[Depends(get_current_user)])

NEEDS_LOCATION = "Sunrise, midday and sunset need the home location: set your address in Settings → Home first."


def _sched(request: Request):
    return request.app.state.scheduler


async def _reload(request: Request):
    curves = getattr(request.app.state, "curves", None)
    if curves is not None:
        await curves.reload()


def _id(curve_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(curve_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Curve not found.")


async def _out(db: AsyncSession, c: LightCurve) -> dict:
    members = (await db.execute(select(LightCurveMember.ieee_address).where(LightCurveMember.curve_id == c.id))).scalars().all()
    return {"id": str(c.id), "name": c.name, "enabled": c.enabled, "points": c.points, "members": list(members)}


async def _set_members(db: AsyncSession, curve_id: uuid.UUID, members: list[str]):
    """This curve's followers become exactly `members`; a light on another curve moves here."""
    await db.execute(delete(LightCurveMember).where(LightCurveMember.curve_id == curve_id))
    if members:
        await db.execute(delete(LightCurveMember).where(LightCurveMember.ieee_address.in_(members)))
        db.add_all([LightCurveMember(ieee_address=m, curve_id=curve_id) for m in members])


async def _lights_only(request: Request, members: list[str]):
    """Only lights with warmth or brightness can follow a curve (not plugs)."""
    if not members:
        return
    bus = request.app.state.bus
    exposes = json.loads(await bus.redis.get("gateway:device_exposes") or "{}")
    bad = [m for m in members if not any(p.get("property") in ("color_temp", "brightness") for p in exposes.get(m) or [])]
    if bad:
        names = []
        for m in bad:
            raw = await bus.redis.hget("gateway:digital_twin", m)
            names.append((json.loads(raw) if raw else {}).get("friendly_name", m))
        raise HTTPException(status_code=422, detail=f"Only lights with warmth or brightness can follow a curve: {', '.join(names)}.")


def _check(spec: CurveSpec | PreviewRequest, request: Request):
    sched = _sched(request)
    if uses_sun(spec.points) and sched.active and sched.loc is None:
        raise HTTPException(status_code=422, detail=NEEDS_LOCATION)


@router.get("")
async def list_curves(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(LightCurve).order_by(LightCurve.created_at))).scalars().all()
    return [await _out(db, c) for c in rows]


@router.post("", status_code=201)
async def create_curve(spec: CurveSpec, request: Request, db: AsyncSession = Depends(get_db)):
    _check(spec, request)
    await _lights_only(request, spec.members)
    c = LightCurve(name=spec.name, enabled=spec.enabled, points=[p.model_dump() for p in spec.points])
    db.add(c)
    await db.flush()
    await _set_members(db, c.id, spec.members)
    await db.commit()
    await db.refresh(c)
    await _reload(request)
    return await _out(db, c)


# Fixed paths before /{curve_id}.
@router.get("/status")
async def curve_status(request: Request):
    """Each following light: its curve, target now, next change, and whether it's paused."""
    curves = getattr(request.app.state, "curves", None)
    return {"active": bool(curves and curves.active), "lights": curves.status() if curves else {}}


@router.post("/preview")
async def preview(body: PreviewRequest, request: Request):
    """The curve across today (every 15 min), the sun times, and its values now, for the editor."""
    sched = _sched(request)
    now = datetime.now(timezone.utc)
    day = now.astimezone(sched.tz).date()
    return {
        "timezone": sched.tz.key,
        "samples": samples(body.points, day, sched.tz, sched.loc),
        "sun": sun_times(day, sched.tz, sched.loc),
        "now": {k: (round(v) if v is not None else None) for k, v in target(body.points, now, sched.tz, sched.loc).items()},
        "next": next_changes(body.points, now, sched.tz, sched.loc),
        "warnings": [NEEDS_LOCATION] if uses_sun(body.points) and sched.loc is None else [],
    }


@router.put("/lights/{ieee}")
async def set_light_curve(ieee: str, body: MemberRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """From a light's drawer: follow this curve, or none."""
    if body.curve_id is not None:
        await _lights_only(request, [ieee])
    await db.execute(delete(LightCurveMember).where(LightCurveMember.ieee_address == ieee))
    if body.curve_id is not None:
        cid = _id(body.curve_id)
        if await db.get(LightCurve, cid) is None:
            raise HTTPException(status_code=404, detail="Curve not found.")
        db.add(LightCurveMember(ieee_address=ieee, curve_id=cid))
    await db.commit()
    await _reload(request)
    return {"status": "ok"}


@router.post("/lights/{ieee}/resume")
async def resume_light(ieee: str, request: Request):
    curves = getattr(request.app.state, "curves", None)
    if not curves or not curves.active:
        raise HTTPException(status_code=503, detail="Day curves aren't running.")
    await curves.resume(ieee)
    return {"status": "ok"}


@router.put("/{curve_id}")
async def update_curve(curve_id: str, spec: CurveSpec, request: Request, db: AsyncSession = Depends(get_db)):
    c = await db.get(LightCurve, _id(curve_id))
    if c is None:
        raise HTTPException(status_code=404, detail="Curve not found.")
    _check(spec, request)
    await _lights_only(request, spec.members)
    c.name, c.enabled, c.points = spec.name, spec.enabled, [p.model_dump() for p in spec.points]
    await _set_members(db, c.id, spec.members)
    await db.commit()
    await db.refresh(c)
    await _reload(request)
    return await _out(db, c)


@router.delete("/{curve_id}", status_code=204)
async def delete_curve(curve_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    c = await db.get(LightCurve, _id(curve_id))
    if c is None:
        raise HTTPException(status_code=404, detail="Curve not found.")
    await db.delete(c)
    await db.commit()
    await _reload(request)
