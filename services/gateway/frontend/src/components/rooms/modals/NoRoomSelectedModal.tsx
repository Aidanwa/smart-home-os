// services/gateway/frontend/src/components/rooms/modals/NoRoomSelectedModal.tsx
import { AlertCircle, X } from 'lucide-react';

interface NoRoomSelectedModalProps {
  onClose: () => void;
}

export function NoRoomSelectedModal({ onClose }: NoRoomSelectedModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center gap-2 text-amber-400 font-medium">
            <AlertCircle size={18} />
            <h2>Placement Error</h2>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-1 rounded-md hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 text-neutral-300 text-sm leading-relaxed">
          Please select a room on the canvas first before attempting to place a device. Click any room to highlight it, then try again.
        </div>

        <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-100 hover:bg-white text-neutral-900 text-sm font-medium rounded-lg transition-colors"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}