// Pickers shared by device triggers and device conditions: device → attribute → comparison → value.
import type { AttributeInfo, AttributeMap, Scalar, TempUnit, TriggerOp } from './types';
import { EVENT_ATTRIBUTES, displayUnit, formatValue, fromDisplay, toDisplay } from './types';
import { attributeLabel, findInfo, opText } from './fieldLogic';
import { input } from './styles';
import { NumberField } from './NumberField';

export function DeviceAttributePicker({ attributes, device, attribute, onPick }: {
  attributes: AttributeMap;
  device: string;
  attribute: string;
  onPick: (device: string, attribute: string) => void;
}) {
  const devices = Object.entries(attributes).sort((a, b) => a[1].friendly_name.localeCompare(b[1].friendly_name));
  const props = attributes[device]?.properties ?? [];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <select className={input} value={device} onChange={e => {
        const first = attributes[e.target.value]?.properties[0]?.property ?? '';
        onPick(e.target.value, first);
      }}>
        {!attributes[device] && <option value={device}>{device ? `Missing device (${device})` : 'Pick a device'}</option>}
        {devices.map(([ieee, d]) => <option key={ieee} value={ieee}>{d.friendly_name}</option>)}
      </select>
      <select className={input} value={attribute} onChange={e => onPick(device, e.target.value)}>
        {!props.some(p => p.property === attribute) && <option value={attribute}>{attribute || 'Pick a reading'}</option>}
        {props.map(p => <option key={p.property} value={p.property}>{attributeLabel(p.property)}</option>)}
      </select>
    </div>
  );
}

export function CurrentReading({ attributes, device, attribute, tempUnit }: { attributes: AttributeMap; device: string; attribute: string; tempUnit: TempUnit }) {
  const value = attributes[device]?.current?.[attribute];
  if (value === undefined || value === null || EVENT_ATTRIBUTES.includes(attribute)) return null;
  const info = findInfo(attributes, device, attribute);
  return <p className="text-xs text-neutral-500">Now: {formatValue(value as Scalar, info, tempUnit)}</p>;
}

/** Value entry matching the attribute's type; numbers are shown in display units (°F) and stored native (°C). */
export function ValueInput({ info, value, onChange, tempUnit }: {
  info: AttributeInfo | undefined;
  value: Scalar | null;
  onChange: (v: Scalar) => void;
  tempUnit: TempUnit;
}) {
  const choices: Scalar[] | null =
    info?.type === 'binary' ? [info.value_on ?? true, info.value_off ?? false]
    : info?.values?.length ? info.values
    : null;
  if (choices) {
    const current = JSON.stringify(value);
    return (
      <select className={input} value={current} onChange={e => onChange(JSON.parse(e.target.value))}>
        {!choices.some(c => JSON.stringify(c) === current) && <option value={current}>{String(value)}</option>}
        {choices.map(c => <option key={JSON.stringify(c)} value={JSON.stringify(c)}>{String(c)}</option>)}
      </select>
    );
  }
  if (info?.type === 'numeric' || typeof value === 'number') {
    const unit = displayUnit(info, tempUnit);
    const warmth = info?.unit === 'mired';
    return (
      <div className="flex items-center gap-2">
        <NumberField className={input}
          value={typeof value === 'number' ? toDisplay(value, info, tempUnit) : null}
          min={warmth ? 0 : undefined} max={warmth ? 100 : undefined}
          allowNegative={info?.unit === '°C' || (info?.value_min ?? 0) < 0}
          onChange={n => onChange(fromDisplay(n, info, tempUnit))} />
        {unit && <span className="text-xs text-neutral-400 shrink-0 w-10">{unit}</span>}
      </div>
    );
  }
  return <input className={input} value={value === null ? '' : String(value)} onChange={e => onChange(e.target.value)} />;
}

export function OpSelect({ ops, op, attribute, onChange }: { ops: TriggerOp[]; op: TriggerOp; attribute: string; onChange: (op: TriggerOp) => void }) {
  return (
    <select className={input} value={op} onChange={e => onChange(e.target.value as TriggerOp)}>
      {!ops.includes(op) && <option value={op}>{opText(op, attribute)}</option>}
      {ops.map(o => <option key={o} value={o}>{opText(o, attribute)}</option>)}
    </select>
  );
}
