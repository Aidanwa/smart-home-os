import { Trash2 } from 'lucide-react';
import type { AttributeMap, ConditionOp, LeafCondition, RoomOption, TempUnit } from './types';
import { CurrentReading, DeviceAttributePicker, OpSelect, ValueInput } from './DeviceFields';
import { defaultComparison, findInfo, opsFor } from './fieldLogic';
import { DayChips, MinutesField, OccupiedChoice, RoomPicker } from './TriggerFields';
import { card, chip, iconBtn, input } from './styles';

const TITLES: Record<LeafCondition['type'], string> = {
  time_window: 'Between times', days: 'On days', device: 'Device reading', sun: 'Sun', room: 'Room occupancy',
};

export function ConditionRow({ condition, onChange, onRemove, attributes, tempUnit, rooms = [] }: {
  condition: LeafCondition;
  onChange: (c: LeafCondition) => void;
  onRemove: () => void;
  attributes: AttributeMap;
  tempUnit: TempUnit;
  rooms?: RoomOption[];
}) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-neutral-500">{TITLES[condition.type]}</span>
        <button type="button" className={`${iconBtn} hover:text-red-400`} onClick={onRemove} aria-label="Remove"><Trash2 size={16} /></button>
      </div>
      <Fields condition={condition} onChange={onChange} attributes={attributes} tempUnit={tempUnit} rooms={rooms} />
    </div>
  );
}

function Fields({ condition: c, onChange, attributes, tempUnit, rooms }: { condition: LeafCondition; onChange: (c: LeafCondition) => void; attributes: AttributeMap; tempUnit: TempUnit; rooms: RoomOption[] }) {
  if (c.type === 'room') {
    return (
      <>
        <RoomPicker rooms={rooms} room={c.room} onPick={room => onChange({ ...c, room })} />
        <OccupiedChoice state={c.state} onChange={state => onChange({ ...c, state })} />
        <MinutesField text="And has been for at least" seconds={c.for_s} onChange={for_s => onChange({ ...c, for_s })} />
      </>
    );
  }
  if (c.type === 'time_window') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
        after
        <input type="time" className={`${input} w-32`} value={c.after} onChange={e => e.target.value && onChange({ ...c, after: e.target.value.slice(0, 5) })} />
        and before
        <input type="time" className={`${input} w-32`} value={c.before} onChange={e => e.target.value && onChange({ ...c, before: e.target.value.slice(0, 5) })} />
        {c.before < c.after && <p className="w-full text-xs text-neutral-600">Overnight: wraps past midnight.</p>}
      </div>
    );
  }
  if (c.type === 'days') {
    return <DayChips days={c.days} allowNull={false} onChange={days => days && onChange({ ...c, days })} />;
  }
  if (c.type === 'sun') {
    return (
      <div className="flex gap-1.5">
        {(['down', 'up'] as const).map(s => (
          <button key={s} type="button" className={chip(c.state === s)} onClick={() => onChange({ ...c, state: s })}>
            {s === 'down' ? "It's dark (sun down)" : "It's light (sun up)"}
          </button>
        ))}
      </div>
    );
  }
  const info = findInfo(attributes, c.device, c.attribute);
  const ops = opsFor(info, c.attribute, false) as ConditionOp[];
  return (
    <>
      <DeviceAttributePicker attributes={attributes} device={c.device} attribute={c.attribute} onPick={(device, attribute) => {
        const d = defaultComparison(findInfo(attributes, device, attribute), attribute, attributes[device]?.current?.[attribute]);
        onChange({ ...c, device, attribute, op: (d.op === 'changes' ? 'eq' : d.op) as ConditionOp, value: d.value });
      }} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <OpSelect ops={ops} op={c.op} attribute={c.attribute} onChange={op => {
          const numeric = ['gt', 'gte', 'lt', 'lte'].includes(op);
          onChange({ ...c, op: op as ConditionOp, value: numeric && typeof c.value !== 'number' ? 0 : c.value });
        }} />
        <ValueInput info={info} attribute={c.attribute} value={c.value} tempUnit={tempUnit} onChange={value => onChange({ ...c, value })} />
      </div>
      <CurrentReading attributes={attributes} device={c.device} attribute={c.attribute} tempUnit={tempUnit} />
    </>
  );
}
