import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../ui/dialog';
import { dialogButton } from '../../ui/dialog-styles';
import { ROOM_COLORS } from '../constants';
import { NumberField } from '../../routines/NumberField';

export function AddRoomModal({ floorLabel, onClose, onCreate }: { floorLabel: string; onClose: () => void; onCreate: (name: string, width: number, height: number, color: string) => Promise<void>; }) {
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
    <Dialog open onOpenChange={o => !o && !isSubmitting && onClose()}>
      <DialogContent className="flex flex-col gap-6">
        <div>
          <DialogTitle>Add a room</DialogTitle>
          <DialogDescription>{floorLabel}. You can move and resize it afterwards.</DialogDescription>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Name</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="e.g. Living Room" autoFocus className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400" />
          </label>

          <div className="flex gap-4">
            <label className="flex flex-col gap-1.5 flex-1 min-w-0">
              <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Width (ft)</span>
              <NumberField value={widthFt} onChange={setWidthFt} min={2} max={200} ariaLabel="Width in feet" className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-neutral-400 w-full" />
            </label>
            <label className="flex flex-col gap-1.5 flex-1 min-w-0">
              <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Height (ft)</span>
              <NumberField value={heightFt} onChange={setHeightFt} min={2} max={200} ariaLabel="Height in feet" className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-neutral-400 w-full" />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
             <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Colour</span>
             <div className="flex items-center gap-2">
                {ROOM_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} className={`w-10 h-10 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`} style={{ backgroundColor: c }} aria-label={`Select color ${c}`} />
                ))}
             </div>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-400/10 p-2 rounded">{error}</p>}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} disabled={isSubmitting} className={dialogButton.cancel}>Cancel</button>
          <button onClick={handleSubmit} disabled={isSubmitting} className={dialogButton.primary}>{isSubmitting ? 'Creating…' : 'Create room'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}