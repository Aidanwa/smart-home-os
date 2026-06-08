import { useState } from 'react';
import { X } from 'lucide-react';
import { ROOM_COLORS, GRID_FT } from '../constants';

export function AddRoomModal({ floorLevel, onClose, onCreate }: { floorLevel: number; onClose: () => void; onCreate: (name: string, width: number, height: number, color: string) => Promise<void>; }) {
  const [name, setName] = useState('');
  const [widthFt, setWidthFt] = useState(10);
  const [heightFt, setHeightFt] = useState(10);
  const [color, setColor] = useState(ROOM_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Room name is required.'); return; }
    setIsSubmitting(true); setError('');
    try {
      await onCreate(name.trim(), widthFt, heightFt, color);
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create room.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-lg">Add Room — Floor {floorLevel}</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors"><X size={20} /></button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Name</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="e.g. Living Room" autoFocus className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400" />
          </label>

          <div className="flex gap-4">
            <label className="flex flex-col gap-1.5 flex-1 min-w-0">
              <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Width (ft)</span>
              <input type="number" step={GRID_FT} value={widthFt} onChange={e => setWidthFt(Math.max(2, Number(e.target.value)))} min={2} className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-neutral-400 w-full" />
            </label>
            <label className="flex flex-col gap-1.5 flex-1 min-w-0">
              <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Height (ft)</span>
              <input type="number" step={GRID_FT} value={heightFt} onChange={e => setHeightFt(Math.max(2, Number(e.target.value)))} min={2} className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-neutral-400 w-full" />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
             <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Color Label</span>
             <div className="flex items-center gap-2">
                {ROOM_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`} style={{ backgroundColor: c }} aria-label={`Select color ${c}`} />
                ))}
             </div>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-400/10 p-2 rounded">{error}</p>}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-600 text-neutral-300 text-sm font-medium hover:bg-neutral-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 px-4 py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isSubmitting ? 'Creating…' : 'Create Room'}</button>
        </div>
      </div>
    </div>
  );
}