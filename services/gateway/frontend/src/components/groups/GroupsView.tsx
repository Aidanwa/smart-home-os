import { useState } from 'react';
import { Plus, Trash2, Settings2, X, Pencil, Check, AlertTriangle } from 'lucide-react';
import { useGroups } from '../../hooks/useGroups';
import type { GroupInfo } from '../../hooks/useGroups';
import type { DeviceState } from '../../hooks/useDevices';
import { DeviceRenderer } from '../devices/DeviceRenderer';

interface Props {
  devices: Record<string, DeviceState>;
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
}

// Polished Tooltip Wrapper utilizing Tailwind CSS group hovering
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

export function GroupsView({ devices, sendCommand, toggleDevice, renameDevice }: Props) {
  const { groups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand, renameGroup } = useGroups();
  
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [managingGroup, setManagingGroup] = useState<GroupInfo | null>(null);

  // States for renaming
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');

  // State for delete confirmation panel
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);

  // Filter out default Zigbee2MQTT groups if any exist
  const visibleGroups = groups.filter(g => !g.friendly_name.includes('default_bind'));

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      createGroup(newGroupName.trim());
      setNewGroupName('');
      setIsCreating(false);
    }
  };

  const handleRenameSubmit = (oldName: string) => {
    if (editNameDraft.trim() && editNameDraft !== oldName) {
      renameGroup(oldName, editNameDraft.trim());
    }
    setEditingGroup(null);
  };

  const confirmDelete = () => {
    if (groupToDelete) {
      deleteGroup(groupToDelete);
      setGroupToDelete(null);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      
      {/* Header & Create Group */}
      <div className="flex justify-between items-center bg-neutral-900/50 p-4 rounded-2xl border border-neutral-800 shadow-sm">
        <div>
          <h2 className="text-lg font-medium text-white">Groups</h2>
          <p className="text-sm text-neutral-400">Control multiple devices together</p>
        </div>
        {!isCreating ? (
          <Tooltip text="Create a new room or group">
            <button 
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Plus size={16} /> New Group
            </button>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2">
            <input 
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Living Room"
              className="bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-white"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
            />
            <Tooltip text="Save new group">
              <button onClick={handleCreateGroup} className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-xl text-sm font-medium text-white transition-colors">Save</button>
            </Tooltip>
            <Tooltip text="Cancel creation">
              <button onClick={() => setIsCreating(false)} className="bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-xl text-sm font-medium text-white transition-colors">Cancel</button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Group Sections */}
      {visibleGroups.map(group => {
        // Cross-reference devices using the static IEEE Address to survive device renaming 
        const activeDevicesInGroup = Object.entries(devices).filter(([name, state]) => {
          if (state.ieee_address) {
            return group.members.some(m => m.ieee_address === state.ieee_address);
          }
          // Fallback to name if IEEE hasn't populated yet
          return group.members.some(m => m.name === name);
        });

        return (
          <div key={group.id} className="space-y-4">
            {/* Group Header */}
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800/50 group/header">
              
              {/* Title & Rename Input */}
              <div className="flex items-center gap-2">
                {editingGroup === group.friendly_name ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editNameDraft}
                      onChange={(e) => setEditNameDraft(e.target.value)}
                      className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1 text-xl font-medium tracking-tight focus:outline-none focus:border-blue-500 text-neutral-200 w-48"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(group.friendly_name);
                        if (e.key === 'Escape') setEditingGroup(null);
                      }}
                    />
                    <Tooltip text="Confirm rename">
                      <button 
                        onClick={() => handleRenameSubmit(group.friendly_name)} 
                        className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors"
                      >
                        <Check size={18} />
                      </button>
                    </Tooltip>
                    <Tooltip text="Cancel editing">
                      <button 
                        onClick={() => setEditingGroup(null)} 
                        className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </Tooltip>
                  </div>
                ) : (
                  <>
                    <h3 className="text-xl font-medium tracking-tight text-neutral-200">{group.friendly_name}</h3>
                    <Tooltip text="Rename group">
                      <button
                        onClick={() => {
                          setEditingGroup(group.friendly_name);
                          setEditNameDraft(group.friendly_name);
                        }}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors opacity-0 md:group-hover/header:opacity-100"
                      >
                        <Pencil size={16} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
              
              {/* Group Controls */}
              <div className="flex items-center gap-2">
                <Tooltip text={`Turn all ${group.friendly_name} devices ON`}>
                  <button onClick={() => sendGroupCommand(group.friendly_name, { state: 'ON' })} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium transition-colors">All On</button>
                </Tooltip>
                <Tooltip text={`Turn all ${group.friendly_name} devices OFF`}>
                  <button onClick={() => sendGroupCommand(group.friendly_name, { state: 'OFF' })} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium transition-colors mr-2">All Off</button>
                </Tooltip>
                <Tooltip text="Add or remove devices">
                  <button onClick={() => setManagingGroup(group)} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
                    <Settings2 size={18} />
                  </button>
                </Tooltip>
                <Tooltip text="Delete this group">
                  <button onClick={() => setGroupToDelete(group.friendly_name)} className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                    <Trash2 size={18} />
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Devices in Group Grid */}
            {activeDevicesInGroup.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {activeDevicesInGroup.map(([name, state]) => (
                  <DeviceRenderer key={name} name={state.friendly_name} state={state} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-neutral-900/20 border border-dashed border-neutral-800 rounded-2xl text-neutral-500 text-sm">
                No devices in this group yet. Click the options icon to add some.
              </div>
            )}
          </div>
        );
      })}

      {/* Manage Group Modal */}
      {managingGroup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-neutral-800">
              <h3 className="font-medium text-lg text-white">Manage: {managingGroup.friendly_name}</h3>
              <Tooltip text="Close modal">
                <button onClick={() => setManagingGroup(null)} className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-800 transition-colors"><X size={20} /></button>
              </Tooltip>
            </div>
            
            <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
              {Object.entries(devices).map(([deviceName, state]) => {
                const isInGroup = state.ieee_address 
                  ? managingGroup.members.some(m => m.ieee_address === state.ieee_address)
                  : managingGroup.members.some(m => m.name === deviceName);

                // Pass the IEEE address as the true identifier if available
                const identifier = state.ieee_address || deviceName;

                return (
                  <div key={deviceName} className="flex items-center justify-between p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/50">
                    <span className="text-sm font-medium text-neutral-200">{state.friendly_name}</span>
                    <Tooltip text={isInGroup ? "Remove device from group" : "Add device to group"}>
                      <button
                        onClick={() => {
                          if (isInGroup) removeDeviceFromGroup(managingGroup.friendly_name, identifier);
                          else addDeviceToGroup(managingGroup.friendly_name, identifier);
                          
                          // Optimistically update local modal state
                          setManagingGroup(prev => {
                            if (!prev) return null;
                            const newMembers = isInGroup 
                              ? prev.members.filter(m => m.ieee_address !== state.ieee_address && m.name !== deviceName)
                              : [...prev.members, { ieee_address: state.ieee_address || '', endpoint: 1, name: deviceName }];
                            return { ...prev, members: newMembers };
                          });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isInGroup ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                        }`}
                      >
                        {isInGroup ? 'Remove' : 'Add'}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Panel */}
      {groupToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle size={24} />
              <h3 className="font-medium text-lg">Delete Group?</h3>
            </div>
            <p className="text-neutral-400 text-sm">
              Are you sure you want to delete the group <strong className="text-white">"{groupToDelete}"</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-4">
              <Tooltip text="Cancel deletion">
                <button 
                  onClick={() => setGroupToDelete(null)} 
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-white transition-colors"
                >
                  Cancel
                </button>
              </Tooltip>
              <Tooltip text="Permanently delete group">
                <button 
                  onClick={confirmDelete} 
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Delete
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}