"""Pydantic shapes for routines. The single source of truth for what a stored routine may contain.

Kept flat and plain-worded so the agent can write them later. See docs/scheduler-proposal.md §3.
Triggers: time, sun, device. Conditions: time_window, days, device, sun, and an 'any' group (OR);
the routine's condition list itself is AND. Actions: device, group, delay.
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


def _normalize_days(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    if not v:
        raise ValueError("pick at least one day, or use null for every day")
    return [d for d in DAYS if d in v]  # dedupe and keep week order


# ---------------------------------------------------------------- triggers

class TimeTrigger(_Strict):
    id: ShortId
    type: Literal["time"]
    at: HHMM
    days: list[Day] | None = None  # None = every day

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        return _normalize_days(v)


class SunTrigger(_Strict):
    id: ShortId
    type: Literal["sun"]
    event: Literal["sunrise", "sunset"]
    offset_min: int = Field(0, ge=-720, le=720)  # negative = before the event
    days: list[Day] | None = None  # days of the (offset) fire time; None = every day

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        return _normalize_days(v)


# Attributes Z2M publishes as one-off events (remote buttons). They fire on every message with
# a matching value, because the twin keeps the last value: two 'on_press' in a row are two presses.
EVENT_ATTRIBUTES = {"action"}

Scalar = bool | int | float | str
NUMERIC_OPS = {"gt", "gte", "lt", "lte"}
TriggerOp = Literal["eq", "ne", "gt", "gte", "lt", "lte", "changes"]
ConditionOp = Literal["eq", "ne", "gt", "gte", "lt", "lte"]


def _check_comparison(op: str, value) -> None:
    if op == "changes":
        if value is not None:
            raise ValueError("'changes' takes no value")
        return
    if value is None:
        raise ValueError(f"'{op}' needs a value")
    if op in NUMERIC_OPS and (isinstance(value, bool) or not isinstance(value, (int, float))):
        raise ValueError(f"'{op}' needs a number")


class DeviceTrigger(_Strict):
    """Fires when a device's reported attribute starts matching (or, for event attributes like a
    remote's `action`, on every matching report). `rearm` is a hysteresis margin for numeric ops:
    'above 65, rearm 3' fires once, and not again until the value has dropped to 62 or below."""
    id: ShortId
    type: Literal["device"]
    device: str = Field(min_length=1, max_length=64)  # IEEE address
    attribute: str = Field(min_length=1, max_length=64)
    op: TriggerOp
    value: Scalar | None = None
    rearm: float | None = Field(None, gt=0)
    for_s: int | None = Field(None, ge=1, le=86400)
    cooldown_s: int = Field(0, ge=0, le=86400)

    @model_validator(mode="after")
    def _check(self):
        _check_comparison(self.op, self.value)
        if self.rearm is not None and self.op not in NUMERIC_OPS:
            raise ValueError("a re-arm margin only applies to above/below comparisons")
        if self.for_s is not None and (self.op == "changes" or self.attribute in EVENT_ATTRIBUTES):
            raise ValueError("'for' needs a lasting state, not a one-off change or button press")
        return self


Trigger = Annotated[Union[TimeTrigger, SunTrigger, DeviceTrigger], Field(discriminator="type")]


# ---------------------------------------------------------------- conditions (all must pass)

class TimeWindowCondition(_Strict):
    type: Literal["time_window"]
    after: HHMM
    before: HHMM  # may be earlier than `after`: the window wraps past midnight

    @model_validator(mode="after")
    def _check(self):
        if self.after == self.before:
            raise ValueError("the time window is empty (after == before)")
        return self


class DaysCondition(_Strict):
    type: Literal["days"]
    days: list[Day] = Field(min_length=1)

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        return _normalize_days(v)


class DeviceCondition(_Strict):
    type: Literal["device"]
    device: str = Field(min_length=1, max_length=64)
    attribute: str = Field(min_length=1, max_length=64)
    op: ConditionOp
    value: Scalar

    @model_validator(mode="after")
    def _check(self):
        _check_comparison(self.op, self.value)
        return self


class SunCondition(_Strict):
    type: Literal["sun"]
    state: Literal["up", "down"]


LeafCondition = Annotated[Union[TimeWindowCondition, DaysCondition, DeviceCondition, SunCondition], Field(discriminator="type")]


class AnyCondition(_Strict):
    """Passes if at least one of its conditions does (OR). The routine's top-level list is AND."""
    type: Literal["any"]
    conditions: list[LeafCondition] = Field(min_length=1, max_length=20)


Condition = Annotated[Union[TimeWindowCondition, DaysCondition, DeviceCondition, SunCondition, AnyCondition], Field(discriminator="type")]


def leaf_conditions(conditions: list) -> list:
    """Every non-group condition, with 'any' groups flattened."""
    out = []
    for c in conditions:
        out.extend(c.conditions if isinstance(c, AnyCondition) else [c])
    return out


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
    conditions: list[Condition] = Field(default_factory=list, max_length=20)
    actions: list[Action] = Field(min_length=1, max_length=50)

    def uses_sun(self) -> bool:
        return any(t.type == "sun" for t in self.triggers) or any(c.type == "sun" for c in leaf_conditions(self.conditions))

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
