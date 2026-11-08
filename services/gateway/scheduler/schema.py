"""Pydantic shapes for routines. The single source of truth for what a stored routine may contain.

Kept flat and plain-worded so the agent can write them later. See docs/scheduler-proposal.md §3.
Slice 1 supports time triggers and device/group/delay actions; more types join the unions later.
"""
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.models import DeviceSetRequest

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
Day = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
ShortId = Annotated[str, Field(pattern=r"^[a-z0-9_-]{1,16}$")]

MAX_DELAY_SECONDS = 12 * 3600


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- triggers

class TimeTrigger(_Strict):
    id: ShortId
    type: Literal["time"]
    at: HHMM
    days: list[Day] | None = None  # None = every day

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        if v is None:
            return None
        if not v:
            raise ValueError("pick at least one day, or use null for every day")
        return [d for d in DAYS if d in v]  # dedupe and keep week order


# Becomes a discriminated union on `type` once sun/device triggers exist (slice 2).
Trigger = TimeTrigger


# ---------------------------------------------------------------- actions

class SetPayload(DeviceSetRequest):
    """The same fields the /set endpoints accept, but unknown keys are an error in a stored routine."""
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.to_mqtt():
            raise ValueError("set at least one of state, brightness, color_temp, transition")
        return self

    def to_mqtt(self) -> dict:
        return self.model_dump(exclude_none=True)


class DeviceAction(_Strict):
    id: ShortId
    type: Literal["device"]
    device: str = Field(min_length=1, max_length=64)  # IEEE address; the name is resolved at run time
    set: SetPayload
    stop_on_error: bool = False


class GroupAction(_Strict):
    id: ShortId
    type: Literal["group"]
    group: int  # Z2M numeric group id; the name is resolved at run time
    set: SetPayload
    stop_on_error: bool = False


class DelayAction(_Strict):
    id: ShortId
    type: Literal["delay"]
    seconds: float = Field(gt=0, le=MAX_DELAY_SECONDS)
    stop_on_error: bool = False


Action = Annotated[Union[DeviceAction, GroupAction, DelayAction], Field(discriminator="type")]


# ---------------------------------------------------------------- routine

class RoutineSpec(_Strict):
    """The user-editable part of a routine (everything except ids, owner and run bookkeeping)."""
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    enabled: bool = True
    mode: Literal["single", "restart"] = "single"
    grace_minutes: int = Field(5, ge=0, le=1440)
    triggers: list[Trigger] = Field(default_factory=list, max_length=20)  # empty = run-now only
    conditions: list[dict] = Field(default_factory=list, max_length=0)    # arrive in slice 2
    actions: list[Action] = Field(min_length=1, max_length=50)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("name can't be blank")
        return v

    @model_validator(mode="after")
    def _unique_ids(self):
        for label, items in (("trigger", self.triggers), ("action", self.actions)):
            ids = [i.id for i in items]
            dupes = {i for i in ids if ids.count(i) > 1}
            if dupes:
                raise ValueError(f"duplicate {label} id(s): {', '.join(sorted(dupes))}")
        return self
