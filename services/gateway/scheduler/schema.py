"""Pydantic shapes for routines. The single source of truth for what a stored routine may contain.

Kept flat and plain-worded so the agent can write them (tools/routines_api.py). See the Routines section of CLAUDE.md.
Triggers: time, sun, device, room. Conditions: time_window, days, device, sun, room, and an 'any' group (OR);
the routine's condition list itself is AND. Actions: device, group, delay, fade, spotify_play,
spotify_ctrl, agent, notify, routine (Spotify and agent actions go through the agent as the
routine's owner; see agent_client.py; notify is a web push, core/push.py; routine starts another
routine).
"""
import uuid
from datetime import date as date_
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
    """Every day (or the listed days) at `at`; with `date`, once only (a one-time reminder)."""
    id: ShortId
    type: Literal["time"]
    at: HHMM
    days: list[Day] | None = None  # None = every day
    date: date_ | None = None  # fires once, on this local date; days must then be None

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        return _normalize_days(v)

    @model_validator(mode="after")
    def _once(self):
        if self.date is not None and self.days is not None:
            raise ValueError("a one-time trigger (date) can't also have days")
        return self


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
    # Also fire if the reading already matches when the routine is saved or the hub starts
    # (normally only a change *into* the matching state fires).
    fire_on_start: bool = False

    @model_validator(mode="after")
    def _check(self):
        _check_comparison(self.op, self.value)
        if self.rearm is not None and self.op not in NUMERIC_OPS:
            raise ValueError("a re-arm margin only applies to above/below comparisons")
        lasting = self.op != "changes" and self.attribute not in EVENT_ATTRIBUTES
        if self.for_s is not None and not lasting:
            raise ValueError("'for' needs a lasting state, not a one-off change or button press")
        if self.fire_on_start and not lasting:
            raise ValueError("'fire if already true' needs a lasting state, not a one-off change or button press")
        return self


class RoomTrigger(_Strict):
    """Fires when a room becomes occupied or empty: occupied while any presence or motion sensor
    placed in it (Rooms floor plan) says someone's there (core/rooms.py). Runs on the device-trigger
    machinery, watching the pseudo-device "room:<id>" (see Scheduler._watch)."""
    id: ShortId
    type: Literal["room"]
    room: uuid.UUID
    state: Literal["occupied", "empty"]
    for_s: int | None = Field(None, ge=1, le=86400)
    cooldown_s: int = Field(0, ge=0, le=86400)
    fire_on_start: bool = False


Trigger = Annotated[Union[TimeTrigger, SunTrigger, DeviceTrigger, RoomTrigger], Field(discriminator="type")]


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


class RoomCondition(_Strict):
    """The room is occupied / empty (optionally: has been for at least for_s)."""
    type: Literal["room"]
    room: uuid.UUID
    state: Literal["occupied", "empty"]
    for_s: int | None = Field(None, ge=1, le=86400)


LeafCondition = Annotated[Union[TimeWindowCondition, DaysCondition, DeviceCondition, SunCondition, RoomCondition], Field(discriminator="type")]


class AnyCondition(_Strict):
    """Passes if at least one of its conditions does (OR). The routine's top-level list is AND."""
    type: Literal["any"]
    conditions: list[LeafCondition] = Field(min_length=1, max_length=20)


Condition = Annotated[Union[TimeWindowCondition, DaysCondition, DeviceCondition, SunCondition, RoomCondition, AnyCondition], Field(discriminator="type")]


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
        if self.spatial_learning is not None:
            raise ValueError("spatial learning can't be run from a routine (start it from the sensor's settings)")
        if self.color_options is not None:
            raise ValueError("'remember warmth while off' is a light setting; change it in the light's settings")
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


SpotifyUri = Annotated[str, Field(pattern=r"^spotify:(playlist|album|artist|track|show|episode):[A-Za-z0-9]+$")]
Mired = Annotated[int, Field(ge=150, le=500)]


class SpotifyPlayAction(_Strict):
    """Play a playlist/album/artist/track on a speaker (by name), as the routine's owner.
    Optional volume ramp: start at `volume`, rise (or fall) to `ramp_to` over `ramp_s`."""
    id: ShortId
    type: Literal["spotify_play"]
    speaker: str = Field(min_length=1, max_length=100)
    uri: SpotifyUri
    title: str | None = Field(None, max_length=200)  # display only (what the picker showed)
    volume: int | None = Field(None, ge=0, le=100)
    ramp_to: int | None = Field(None, ge=0, le=100)
    ramp_s: int | None = Field(None, ge=30, le=7200)
    shuffle: bool | None = None
    stop_on_error: bool = False

    @model_validator(mode="after")
    def _check(self):
        if (self.ramp_to is None) != (self.ramp_s is None):
            raise ValueError("a volume ramp needs both ramp_to and ramp_s")
        if self.ramp_to is not None and self.volume is None:
            raise ValueError("a volume ramp needs a starting volume")
        return self


class SpotifyCtrlAction(_Strict):
    id: ShortId
    type: Literal["spotify_ctrl"]
    cmd: Literal["pause", "resume", "next", "previous", "volume"]
    speaker: str | None = Field(None, max_length=100)  # None = whatever is playing
    volume: int | None = Field(None, ge=0, le=100)
    stop_on_error: bool = False

    @model_validator(mode="after")
    def _check(self):
        if (self.cmd == "volume") != (self.volume is not None):
            raise ValueError("volume is required for cmd 'volume', and only for it")
        return self


class FadeAction(_Strict):
    """Fade a light or group to a brightness (0 = fade to off), optionally also its colour
    temperature. 'native' hands the whole fade to the bulb (one command with a transition);
    'stepped' sends small steps for bulbs that mishandle long transitions, and stops if someone
    changes the light. wait=false lets the next actions run while it fades."""
    id: ShortId
    type: Literal["fade"]
    device: str | None = Field(None, max_length=64)  # IEEE; exactly one of device / group
    group: int | None = None
    to_brightness: int = Field(ge=0, le=254)
    from_brightness: int | None = Field(None, ge=1, le=254)  # None = from where it is (or 1 if off)
    to_color_temp: Mired | None = None
    from_color_temp: Mired | None = None
    duration_s: int = Field(ge=1, le=6000)  # Zigbee transitions max out around 6553 s
    method: Literal["native", "stepped"] = "native"
    wait: bool = False
    stop_on_error: bool = False

    @model_validator(mode="after")
    def _check(self):
        if (self.device is None) == (self.group is None):
            raise ValueError("a fade targets exactly one of device or group")
        if self.from_color_temp is not None and self.to_color_temp is None:
            raise ValueError("from_color_temp needs to_color_temp")
        return self


class AgentAction(_Strict):
    """Run a plain-language instruction through the agent's LLM loop, as the routine's owner.
    Costs tokens and can vary between runs; capped at AGENT_RUNS_PER_HOUR per routine."""
    id: ShortId
    type: Literal["agent"]
    prompt: str = Field(min_length=1, max_length=1000)
    notify: Literal["owner", "everyone"] | None = None  # send the agent's reply as a push notification
    stop_on_error: bool = False


AGENT_RUNS_PER_HOUR = 2


class NotifyAction(_Strict):
    """Send a push notification to the installed app: the routine owner's devices, or everyone's."""
    id: ShortId
    type: Literal["notify"]
    title: str | None = Field(None, max_length=100)  # None = the routine's name
    message: str = Field(min_length=1, max_length=300)
    to: Literal["owner", "everyone"] = "owner"
    stop_on_error: bool = False


class RoutineAction(_Strict):
    """Start another routine as its own run (it shows in that routine's history). wait=true carries
    on only once it has finished, and its outcome becomes this step's. Its conditions are skipped,
    as with Run now, unless check_conditions. A routine that's turned off isn't run. Loops are
    refused when saving (api/routine_routes.py) and again at run time (MAX_CALL_DEPTH)."""
    id: ShortId
    type: Literal["routine"]
    routine: uuid.UUID
    wait: bool = False
    check_conditions: bool = False
    stop_on_error: bool = False


MAX_CALL_DEPTH = 5  # routines calling routines, counting the first one


Action = Annotated[
    Union[DeviceAction, GroupAction, DelayAction, FadeAction, SpotifyPlayAction, SpotifyCtrlAction, AgentAction,
          NotifyAction, RoutineAction],
    Field(discriminator="type"),
]


# ---------------------------------------------------------------- routine

def is_one_time(triggers: list) -> bool:
    """A one-time routine (a reminder): every trigger is a dated time trigger. Takes parsed
    triggers or the stored JSON dicts."""
    def dated(t):
        return (t.get("type"), t.get("date")) if isinstance(t, dict) else (t.type, getattr(t, "date", None))
    return bool(triggers) and all(kind == "time" and d for kind, d in map(dated, triggers))


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

    def is_one_time(self) -> bool:
        return is_one_time(self.triggers)

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
