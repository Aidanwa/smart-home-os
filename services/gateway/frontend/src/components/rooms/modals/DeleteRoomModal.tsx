export function DeleteRoomModal({ roomName, onClose, onConfirm }: { roomName: string; onClose: () => void; onConfirm: () => void; }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-5">
        <div>
          <h2 className="text-white font-semibold text-lg">Delete Room?</h2>
          <p className="text-neutral-400 text-sm mt-1 leading-relaxed">
            Are you sure you want to delete <strong className="text-neutral-200">{roomName}</strong>? This will remove the spatial zone, but devices inside will not be deleted from the network.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-600 text-neutral-300 text-sm font-medium hover:bg-neutral-800 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
}

