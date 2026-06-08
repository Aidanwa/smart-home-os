import {useState} from 'react';
import { ROOM_COLORS, ftToPx } from '../constants';
import type { LogicalZone } from '../types';
import { Check } from 'lucide-react';

export function InlineEditPopover({ zone, anchorPos, onCommit, onCancel }: { zone: LogicalZone; anchorPos: { x: number; y: number }; onCommit: (id: string, name: string, color: string) => Promise<void>; onCancel: () => void; }) {
  const [value, setValue] = useState(zone.name);
  const [color, setColor] = useState(zone.color || ROOM_COLORS[0]);

  const commit = async () => {
    const trimmed = value.trim();
    if (trimmed) await onCommit(zone.id, trimmed, color);
    else onCancel();
  };

  return (
    <div
      style={{ position: 'fixed', left: anchorPos.x + ftToPx(zone.width) / 2 - 110, top: anchorPos.y + ftToPx(zone.height) / 2 - 45, width: 220, zIndex: 100 }}
      className="bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-2xl flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150"
    >
      <input
        autoFocus
        value={value} 
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
        className="bg-neutral-800 border border-neutral-600 rounded px-3 py-1.5 text-white text-sm font-medium text-center focus:outline-none focus:border-neutral-400 w-full"
      />
      <div className="flex items-center justify-between gap-1">
        <div className="flex gap-1.5">
          {ROOM_COLORS.map(c => (
             <button key={c} onClick={() => setColor(c)} className={`w-5 h-5 rounded-full border border-neutral-800 transition-transform ${color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-110'}`} style={{ backgroundColor: c }} />
          ))}
        </div>
        <button onClick={commit} className="bg-emerald-600 hover:bg-emerald-500 text-white p-1 rounded transition-colors"><Check size={16} /></button>
      </div>
    </div>
  );
}