import { useState, useEffect } from 'react';
import { Pencil, Check, X, Signal, Battery, Clock, Download } from 'lucide-react';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle,
  SheetDescription 
} from '../ui/sheet';
import type { DeviceState } from '../../hooks/useDevices';

// This is to add tooltips to buttons
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

interface DeviceConfigDrawerProps {
  name: string;
  state: DeviceState;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  advancedConfig?: React.ReactNode;
  renameDevice: (oldName: string, newName: string) => void;
}

export function DeviceConfigDrawer({ 
  name, 
  state, 
  isOpen, 
  onOpenChange, 
  advancedConfig,
  renameDevice,
}: DeviceConfigDrawerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(name);

  // Reset draft if the device name actually changes via WebSocket
  useEffect(() => {
    setEditDraft(name);
  }, [name]);

  const handleRenameSubmit = () => {
    if (editDraft.trim() && editDraft !== name) {
      renameDevice(name, editDraft.trim());
    }
    setIsEditing(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto w-full sm:max-w-md flex flex-col gap-8 p-6 sm:p-4">
        
        <SheetHeader className="text-left space-y-0">
          <SheetDescription className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
            Device Configuration
          </SheetDescription>
          
        {/* Rename Module */}
          {isEditing ? (
            <div className="flex items-center gap-2 pt-1">
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xl font-medium tracking-tight focus:outline-none focus:border-blue-500 text-white w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
              <Tooltip text="Save">
                <button onClick={handleRenameSubmit} className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                  <Check size={18} />
                </button>
              </Tooltip>
              <Tooltip text="Cancel">
                <button onClick={() => setIsEditing(false)} className="p-2 rounded-lg bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors">
                  <X size={18} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center justify-between group">
              <SheetTitle className="text-2xl font-semibold tracking-tight text-white pr-4">
                {name}
              </SheetTitle>
              <Tooltip text="Rename Device">
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 rounded-full text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <Pencil size={16} />
                </button>
              </Tooltip>
            </div>
          )}
        </SheetHeader>

        {/* Universal Telemetry Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-neutral-400">Status & Health</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {state.linkquality !== undefined && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Signal size={14} className="text-blue-400" />
                  <span className="text-xs">Signal (LQI)</span>
                </div>
                <span className="font-medium">{state.linkquality} / 255</span>
              </div>
            )}
            {state.battery !== undefined && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Battery size={14} className={state.battery > 20 ? 'text-green-400' : 'text-red-400'} />
                  <span className="text-xs">Battery</span>
                </div>
                <span className="font-medium">{state.battery}%</span>
              </div>
            )}
            {state.last_seen && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50 col-span-2">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Clock size={14} />
                  <span className="text-xs">Last Seen</span>
                </div>
                <span className="font-medium truncate">{new Date(state.last_seen).toLocaleString()}</span>
              </div>
            )}
            {state.update_available && (
              <div className="flex items-center justify-between bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20 col-span-2">
                <div className="flex items-center gap-2 text-yellow-500">
                  <Download size={16} />
                  <span className="font-medium text-sm">Firmware Update</span>
                </div>
                <button className="text-xs font-bold text-yellow-400 bg-yellow-500/20 px-3 py-1 rounded-lg">Install</button>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Config Injection Point */}
        {advancedConfig && (
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-neutral-400">Advanced Settings</h4>
            {advancedConfig}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}