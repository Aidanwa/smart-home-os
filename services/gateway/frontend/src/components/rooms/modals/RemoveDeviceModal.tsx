import { ConfirmDialog } from '../../ui/dialog';

interface RemoveDeviceModalProps {
  deviceName: string;
  roomName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemoveDeviceModal({ deviceName, roomName, onClose, onConfirm }: RemoveDeviceModalProps) {
  return (
    <ConfirmDialog
      open
      onOpenChange={o => !o && onClose()}
      title={deviceName}
      description={`Take it off the ${roomName} floor plan? The device itself isn’t affected.`}
      confirmLabel={`Remove from ${roomName}`}
      destructive
      onConfirm={onConfirm}
    />
  );
}
