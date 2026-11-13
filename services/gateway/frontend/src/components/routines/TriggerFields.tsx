import { Trash2 } from 'lucide-react';
import type { AttributeMap, Day, DeviceTrigger, PersonOption, PresenceTrigger, PresenceWho, RoomOption, RoomTrigger, SunTrigger, TempUnit, TimeTrigger, Trigger, TriggerOp } from './types';
import { DAYS, EVENT_ATTRIBUTES, WEEKDAYS, WEEKEND, deltaFromDisplay, deltaToDisplay, describeDays, describePresence, displayUnit, formatDate } from './types';
import { CurrentReading, DeviceAttributePicker, OpSelect, ValueInput } from './DeviceFields';
import { defaultComparison, findInfo, isNumericOp, opsFor } from './fieldLogic';
import { card, chip, iconBtn, input } from './styles';
import { NumberField } from './NumberField';

export function DayChips({ days, onChange, allowNull = true }: { days: Day[] | null; onChange: (d: Day[] | null) => void; allowNull?: boolean }) {
  const on = days ?? DAYS;
  const toggle = (d: Day) => {
    const next = on.includes(d) ? on.filter(x => x !== d) : DAYS.filter(x => x === d || on.includes(x));
    if (next.length === 0) return;  // at least one day
    onChange(next.length === 7 && allowNull ? null : next);
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map(d => (
          <button key={d} type="button" className={chip(on.includes(d)).replace("px-3", "px-0 min-w-0")} onClick={() => toggle(d)}>
            {d[0].toUpperCase() + d.slice(1, 3)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-1 text-xs text-neutral-500">
        <button type="button" className="min-h-10 px-2 first:-ml-2 hover:text-neutral-300" onClick={() => onChange(allowNull ? null : [...DAYS])}>Every day</button>
        <button type="button" className="min-h-10 px-2 first:-ml-2 hover:text-neutral-300" onClick={() => onChange(WEEKDAYS)}>Weekdays</button>
        <button type="button" className="min-h-10 px-2 first:-ml-2 hover:text-neutral-300" onClick={() => onChange(WEEKEND)}>Weekends</button>
      </div>
    </div>
  );
}

function RowHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{title}</span>
      <button type="button" className={`${iconBtn} hover:text-red-400`} onClick={onRemove} aria-label="Remove"><Trash2 size={16} /></button>
    </div>
  );
}

interface Ctx {
  attributes: AttributeMap;
  tempUnit: TempUnit;
  rooms?: RoomOption[];
  people?: PersonOption[];
}

export function TriggerRow({ trigger, onChange, onRemove, ctx }: { trigger: Trigger; onChange: (t: Trigger) => void; onRemove: () => void; ctx: Ctx }) {
  if (trigger.type === 'time') return <TimeRow trigger={trigger} onChange={onChange} onRemove={onRemove} />;
  if (trigger.type === 'sun') return <SunRow trigger={trigger} onChange={onChange} onRemove={onRemove} />;
  if (trigger.type === 'room') return <RoomRow trigger={trigger} onChange={onChange} onRemove={onRemove} rooms={ctx.rooms ?? []} />;
  if (trigger.type === 'presence') return <PresenceRow trigger={trigger} onChange={onChange} onRemove={onRemove} people={ctx.people ?? []} />;
  return <DeviceRow trigger={trigger} onChange={onChange} onRemove={onRemove} ctx={ctx} />;
}

/** Today as "YYYY-MM-DD" on this device. */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TimeRow({ trigger, onChange, onRemove }: { trigger: TimeTrigger; onChange: (t: TimeTrigger) => void; onRemove: () => void }) {
  const once = !!trigger.date;
  return (
    <div className={card}>
      <RowHeader title={once ? `Once · ${formatDate(trigger.date!)}` : `At a time · ${describeDays(trigger.days)}`} onRemove={onRemove} />
      <div className="flex gap-2">
        <button type="button" className={chip(!once)} onClick={() => onChange({ ...trigger, date: null })}>Repeats</button>
        <button type="button" className={chip(once)} onClick={() => onChange({ ...trigger, date: trigger.date || todayYmd(), days: null })}>Once</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {once && (
          <input type="date" className={`${input} w-44`} value={trigger.date!} required
            onChange={e => e.target.value && onChange({ ...trigger, date: e.target.value })} />
        )}
        <input type="time" className={`${input} w-32`} value={trigger.at} required
          onChange={e => e.target.value && onChange({ ...trigger, at: e.target.value.slice(0, 5) })} />
      </div>
      {once
        ? <p className="text-xs text-neutral-500">Runs once, then moves to One-time in the list. Good for reminders.</p>
        : <DayChips days={trigger.days} onChange={days => onChange({ ...trigger, days })} />}
    </div>
  );
}

function SunRow({ trigger, onChange, onRemove }: { trigger: SunTrigger; onChange: (t: SunTrigger) => void; onRemove: () => void }) {
  const before = trigger.offset_min < 0;
  const mins = Math.abs(trigger.offset_min);
  return (
    <div className={card}>
      <RowHeader title="Sunrise / sunset" onRemove={onRemove} />
      <div className="flex flex-wrap items-center gap-2">
        <NumberField integer min={0} max={720} className={`${input} w-20`} value={mins}
          onChange={m => onChange({ ...trigger, offset_min: before ? -m : m })} />
        <span className="text-sm text-neutral-400">min</span>
        <select className={`${input} w-28`} value={before ? 'before' : 'after'}
          onChange={e => onChange({ ...trigger, offset_min: e.target.value === 'before' ? -mins : mins })}>
          <option value="after">after</option>
          <option value="before">before</option>
        </select>
        <select className={`${input} w-28`} value={trigger.event} onChange={e => onChange({ ...trigger, event: e.target.value as SunTrigger['event'] })}>
          <option value="sunset">sunset</option>
          <option value="sunrise">sunrise</option>
        </select>
      </div>
      <DayChips days={trigger.days} onChange={days => onChange({ ...trigger, days })} />
    </div>
  );
}

/** Room picker shared by the room trigger and room condition. Rooms without a sensor are listed
 *  (the plan may just not have it placed yet) but marked, with a hint underneath. */
export function RoomPicker({ rooms, room, onPick }: { rooms: RoomOption[]; room: string; onPick: (id: string) => void }) {
  const picked = rooms.find(r => r.id === room);
  return (
    <div className="space-y-1">
      <select className={input} value={room} onChange={e => onPick(e.target.value)} aria-label="Room">
        {!picked && <option value={room}>{room ? 'A deleted room' : 'Pick a room'}</option>}
        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.hasSensor ? '' : ' (no sensor)'}</option>)}
      </select>
      {picked && !picked.hasSensor && (
        <p className="text-xs text-amber-400/90">No presence or motion sensor is placed in {picked.name}. Place one there in Rooms.</p>
      )}
      {rooms.length === 0 && <p className="text-xs text-neutral-500">No rooms yet. Draw them in the Rooms tab.</p>}
    </div>
  );
}

export function OccupiedChoice({ state, onChange }: { state: 'occupied' | 'empty'; onChange: (s: 'occupied' | 'empty') => void }) {
  return (
    <div className="flex gap-1.5">
      {(['occupied', 'empty'] as const).map(s => (
        <button key={s} type="button" className={chip(state === s)} onClick={() => onChange(s)}>
          {s === 'occupied' ? 'Someone’s there' : 'It’s empty'}
        </button>
      ))}
    </div>
  );
}

function RoomRow({ trigger, onChange, onRemove, rooms }: { trigger: RoomTrigger; onChange: (t: RoomTrigger) => void; onRemove: () => void; rooms: RoomOption[] }) {
  return (
    <div className={card}>
      <RowHeader title="Room occupancy" onRemove={onRemove} />
      <RoomPicker rooms={rooms} room={trigger.room} onPick={room => onChange({ ...trigger, room })} />
      <OccupiedChoice state={trigger.state} onChange={state => onChange({ ...trigger, state })} />
      <MinutesField text={trigger.state === 'empty' ? 'Only once it has been empty for' : 'Only once someone has been there for'}
        seconds={trigger.for_s} onChange={for_s => onChange({ ...trigger, for_s })}
        hint={trigger.state === 'empty' ? 'e.g. 10 minutes, so stepping out briefly doesn’t turn the lights off.' : undefined} />
      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-500 select-none min-h-10 flex items-center">Options</summary>
        <div className="mt-2 space-y-3">
          <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
            <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={trigger.fire_on_start} onChange={e => onChange({ ...trigger, fire_on_start: e.target.checked })} />
            Also fire if it's already {trigger.state} when saved or when the hub restarts
          </label>
          <MinutesField text="At most once every" seconds={trigger.cooldown_s || null} onChange={s => onChange({ ...trigger, cooldown_s: s ?? 0 })} />
        </div>
      </details>
    </div>
  );
}

/** Who a presence trigger/condition is about: the household (anyone / everyone) or one person.
 *  People without an Arrive/Leave Shortcut are listed but marked, with a hint underneath. */
export function WhoPicker({ people, who, onPick }: { people: PersonOption[]; who: PresenceWho; onPick: (w: PresenceWho) => void }) {
  const household = who === 'anyone' || who === 'everyone';
  const person = people.find(p => p.id === who);
  return (
    <div className="space-y-1">
      <select className={input} value={who} onChange={e => onPick(e.target.value)} aria-label="Who">
        <option value="anyone">Anyone</option>
        <option value="everyone">Everyone</option>
        {!household && !person && <option value={who}>Someone deleted</option>}
        {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.reports ? '' : ' (not set up)'}</option>)}
      </select>
      {person && !person.reports && (
        <p className="text-xs text-amber-400/90">{person.name}’s phone doesn’t report home/away yet. Set it up in Settings → Presence.</p>
      )}
      {household && people.length > 0 && !people.some(p => p.reports) && (
        <p className="text-xs text-amber-400/90">Nobody’s phone reports home/away yet. Set it up in Settings → Presence.</p>
      )}
    </div>
  );
}

/** Home / away as two chips, worded for who it's about ("Everyone has left", "Aidan comes home"). */
export function PresenceChoice({ who, state, people, asCondition, onChange }: {
  who: PresenceWho; state: 'home' | 'away'; people: PersonOption[]; asCondition?: boolean; onChange: (s: 'home' | 'away') => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['home', 'away'] as const).map(s => (
        <button key={s} type="button" className={chip(state === s)} onClick={() => onChange(s)}>
          {describePresence(who, s, people, asCondition)}
        </button>
      ))}
    </div>
  );
}

function PresenceRow({ trigger, onChange, onRemove, people }: { trigger: PresenceTrigger; onChange: (t: PresenceTrigger) => void; onRemove: () => void; people: PersonOption[] }) {
  // Leaving waits 5 minutes by default: a phone near the edge of home can report away and back within a minute.
  const setState = (state: 'home' | 'away') =>
    onChange({ ...trigger, state, for_s: state === 'away' && trigger.for_s === null ? 300 : state === 'home' ? null : trigger.for_s });
  return (
    <div className={card}>
      <RowHeader title="Arrive / leave home" onRemove={onRemove} />
      <WhoPicker people={people} who={trigger.who} onPick={who => onChange({ ...trigger, who })} />
      <PresenceChoice who={trigger.who} state={trigger.state} people={people} onChange={setState} />
      <MinutesField text={trigger.state === 'away' ? 'Only once they’ve been away for' : 'Only once they’ve been home for'}
        seconds={trigger.for_s} onChange={for_s => onChange({ ...trigger, for_s })}
        hint={trigger.state === 'away' ? 'So a phone briefly crossing the edge of home doesn’t fire it.' : undefined} />
      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-500 select-none min-h-10 flex items-center">Options</summary>
        <div className="mt-2 space-y-3">
          <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
            <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={trigger.fire_on_start} onChange={e => onChange({ ...trigger, fire_on_start: e.target.checked })} />
            Also fire if it's already true when saved or when the hub restarts
          </label>
          <MinutesField text="At most once every" seconds={trigger.cooldown_s || null} onChange={s => onChange({ ...trigger, cooldown_s: s ?? 0 })} />
        </div>
      </details>
    </div>
  );
}

export function MinutesField({ text, seconds, onChange, hint }: { text: string; seconds: number | null; onChange: (s: number | null) => void; hint?: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={seconds !== null && seconds > 0} onChange={e => onChange(e.target.checked ? 300 : null)} />
        {text}
      </label>
      {seconds !== null && seconds > 0 && (
        <div className="flex items-center gap-2 mt-1.5">
          <NumberField min={0.02} max={1440} className={`${input} w-24`} value={Math.round((seconds / 60) * 100) / 100}
            onChange={m => onChange(Math.max(1, Math.min(86400, Math.round(m * 60))))} />
          <span className="text-xs text-neutral-400">minutes</span>
        </div>
      )}
      {hint && <p className="text-xs text-neutral-600 mt-1">{hint}</p>}
    </div>
  );
}

function DeviceRow({ trigger, onChange, onRemove, ctx }: { trigger: DeviceTrigger; onChange: (t: DeviceTrigger) => void; onRemove: () => void; ctx: Ctx }) {
  const info = findInfo(ctx.attributes, trigger.device, trigger.attribute);
  const isEvent = EVENT_ATTRIBUTES.includes(trigger.attribute);
  const ops = opsFor(info, trigger.attribute, true);

  const pick = (device: string, attribute: string) => {
    const nextInfo = findInfo(ctx.attributes, device, attribute);
    const { op, value } = defaultComparison(nextInfo, attribute, ctx.attributes[device]?.current?.[attribute]);
    onChange({ ...trigger, device, attribute, op, value, rearm: null, for_s: null, fire_on_start: false });
  };

  const setOp = (op: TriggerOp) => {
    let value = trigger.value;
    if (op === 'changes') value = null;
    else if (value === null || (isNumericOp(op) && typeof value !== 'number')) {
      value = defaultComparison(info, trigger.attribute, ctx.attributes[trigger.device]?.current?.[trigger.attribute]).value;
      if (isNumericOp(op) && typeof value !== 'number') value = 0;
    }
    onChange({
      ...trigger, op, value,
      rearm: isNumericOp(op) ? trigger.rearm : null,
      for_s: op === 'changes' ? null : trigger.for_s,
      fire_on_start: op === 'changes' ? false : trigger.fire_on_start,
    });
  };

  return (
    <div className={card}>
      <RowHeader title={isEvent ? 'Button press' : 'Device reading'} onRemove={onRemove} />
      <DeviceAttributePicker attributes={ctx.attributes} device={trigger.device} attribute={trigger.attribute} onPick={pick} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <OpSelect ops={ops} op={trigger.op} attribute={trigger.attribute} onChange={setOp} />
        {trigger.op !== 'changes' && (
          <ValueInput info={info} attribute={trigger.attribute} value={trigger.value} tempUnit={ctx.tempUnit} onChange={value => onChange({ ...trigger, value })} />
        )}
      </div>
      <CurrentReading attributes={ctx.attributes} device={trigger.device} attribute={trigger.attribute} tempUnit={ctx.tempUnit} />

      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-500 select-none min-h-10 flex items-center">Options</summary>
        <div className="mt-2 space-y-3">
          {!isEvent && trigger.op !== 'changes' && (
            <MinutesField text="Only after it has held for" seconds={trigger.for_s} onChange={for_s => onChange({ ...trigger, for_s })}
              hint="e.g. no motion for 10 minutes. Starts counting when it first matches." />
          )}
          {!isEvent && trigger.op !== 'changes' && (
            <div>
              <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
                <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={trigger.fire_on_start} onChange={e => onChange({ ...trigger, fire_on_start: e.target.checked })} />
                Also fire if it's already true when saved or when the hub restarts
              </label>
              <p className="text-xs text-neutral-600 mt-1">Normally it only fires when the reading changes into a match. Useful for e.g. "heater on below 18°".</p>
            </div>
          )}
          {isNumericOp(trigger.op) && (
            <div>
              <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
                <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={trigger.rearm !== null}
                  onChange={e => onChange({ ...trigger, rearm: e.target.checked ? deltaFromDisplay(2, info, ctx.tempUnit) : null })} />
                Re-arm margin (ignore small wobbles)
              </label>
              {trigger.rearm !== null && (
                <div className="flex items-center gap-2 mt-1.5">
                  <NumberField min={0.01} className={`${input} w-24`} value={deltaToDisplay(trigger.rearm, info, ctx.tempUnit)}
                    onChange={v => onChange({ ...trigger, rearm: deltaFromDisplay(v, info, ctx.tempUnit) })} />
                  <span className="text-xs text-neutral-400">{displayUnit(info, ctx.tempUnit)}</span>
                </div>
              )}
              <p className="text-xs text-neutral-600 mt-1">After firing, it won't fire again until the reading has moved back past the threshold by this much.</p>
            </div>
          )}
          <MinutesField text="At most once every" seconds={trigger.cooldown_s || null} onChange={s => onChange({ ...trigger, cooldown_s: s ?? 0 })} />
        </div>
      </details>
    </div>
  );
}
