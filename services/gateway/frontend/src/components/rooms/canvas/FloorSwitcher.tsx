import { ChevronDown, ChevronUp } from 'lucide-react';

export function FloorSwitcher({ floor, maxFloor, minFloor, onChange }: { floor: number; maxFloor: number; minFloor: number; onChange: (f: number) => void; }) {
  const canUp = floor < maxFloor;
  const canDown = floor > minFloor;

  return (
    <div className="absolute bottom-8 right-8 z-10 flex flex-col items-center bg-neutral-900/90 backdrop-blur border border-neutral-700 shadow-2xl rounded-2xl overflow-hidden select-none">
      <button disabled={!canUp} onClick={() => canUp && onChange(floor + 1)} className={`p-3 transition-colors ${canUp ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white' : 'text-neutral-600 cursor-not-allowed'}`}><ChevronUp size={24} /></button>
      <div className="w-full py-1 text-center bg-neutral-950 text-white text-sm font-bold border-y border-neutral-800">F{floor}</div>
      <button disabled={!canDown} onClick={() => canDown && onChange(floor - 1)} className={`p-3 transition-colors ${canDown ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white' : 'text-neutral-600 cursor-not-allowed'}`}><ChevronDown size={24} /></button>
    </div>
  );
}