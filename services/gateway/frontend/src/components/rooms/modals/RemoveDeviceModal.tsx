// src/components/rooms/modals/RemoveDeviceModal.tsx
import { X, MapPinOff } from 'lucide-react';

interface RemoveDeviceModalProps {
  deviceName: string;
  roomName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemoveDeviceModal({ deviceName, roomName, onClose, onConfirm }: RemoveDeviceModalProps) {
  return (
    // The background overlay itself acts as a cancel button if clicked
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-xs overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()} // Prevent clicking inside the modal from closing it
      >
        {/* Header / Device Name */}
        <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-900/80">
          <div className="flex items-center gap-2 text-neutral-100 font-medium truncate pr-4">
            <MapPinOff size={16} className="text-neutral-400 shrink-0" />
            <span className="truncate" title={deviceName}>{deviceName}</span>
          </div>
          <button 
            onClick={onClose} 
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-1 rounded-md hover:bg-neutral-800 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action Button */}
        <div className="p-3 bg-neutral-950">
          <button 
            onClick={() => {
              onConfirm();
              // Intentionally call onClose here just in case the parent component 
              // doesn't tear down the modal state fast enough
              onClose(); 
            }} 
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-colors border border-red-500/20"
          >
            Remove from {roomName}
          </button>
        </div>
      </div>
    </div>
  );
}