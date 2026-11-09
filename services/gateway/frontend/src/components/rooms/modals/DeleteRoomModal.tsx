import { ConfirmDialog } from '../../ui/dialog';

export function DeleteRoomModal({ roomName, onClose, onConfirm }: { roomName: string; onClose: () => void; onConfirm: () => void; }) {
  return (
    <ConfirmDialog
      open
      onOpenChange={o => !o && onClose()}
      title="Delete room?"
      description={<>Delete <strong className="text-neutral-200">{roomName}</strong> from the floor plan? Its devices aren’t affected; they just become unplaced.</>}
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />
  );
}
