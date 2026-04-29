import { useState } from 'react';
import { Plus, Trash2, Settings2, X } from 'lucide-react';
import { useGroups } from '../../hooks/useGroups';
import type { GroupInfo } from '../../hooks/useGroups';
import type { DeviceState } from '../../hooks/useDevices';
import { DeviceRenderer } from '../devices/DeviceRenderer';

interface Props {
  devices: Record<string, DeviceState>;
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
}

export function GroupsView({ devices, sendCommand, toggleDevice }: Props) {
  const { groups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand } = useGroups();
  
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [managingGroup, setManagingGroup] = useState<GroupInfo | null>(null);

  // Filter out default Zigbee2MQTT groups if any exist (like 'default_bind_group')
  const visibleGroups = groups.filter(g => !g.friendly_name.includes('default_bind'));

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      createGroup(newGroupName.trim());
      setNewGroupName('');
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      
      {/* Header & Create Group */}
      <div className="flex justify-between items-center bg-neutral-900/50 p-4 rounded-2xl border border-neutral-800">
        <div>
          <h2 className="text-lg font-medium">Room Groups</h2>
          <p className="text-sm text-neutral-400">Control multiple devices together</p>
        </div>
        {!isCreating ? (
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={16} /> New Group
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input 
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Living Room"
              className="bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
            />
            <button onClick={handleCreateGroup} className="bg-blue-600 px-3 py-2 rounded-xl text-sm font-medium">Save</button>
            <button onClick={() => setIsCreating(false)} className="bg-neutral-800 px-3 py-2 rounded-xl text-sm font-medium">Cancel</button>
          </div>
        )}
      </div>

      {/* Group Sections */}
      {visibleGroups.map(group => {
        // Find devices that belong to this group based on member names
        const groupDeviceNames = group.members.map(m => m.name);
        const activeDevicesInGroup = Object.entries(devices).filter(([name]) => groupDeviceNames.includes(name));

        return (
          <div key={group.id} className="space-y-4">
            {/* Group Header */}
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800/50">
              <h3 className="text-xl font-medium tracking-tight text-neutral-200">{group.friendly_name}</h3>
              
              <div className="flex items-center gap-2">
                <button onClick={() => sendGroupCommand(group.friendly_name, { state: 'ON' })} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium transition-colors">All On</button>
                <button onClick={() => sendGroupCommand(group.friendly_name, { state: 'OFF' })} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium transition-colors mr-2">All Off</button>
                <button onClick={() => setManagingGroup(group)} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
                  <Settings2 size={18} />
                </button>
                <button onClick={() => deleteGroup(group.friendly_name)} className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            {/* Devices in Group Grid */}
            {activeDevicesInGroup.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {activeDevicesInGroup.map(([name, state]) => (
                  <DeviceRenderer key={name} name={name} state={state} sendCommand={sendCommand} toggleDevice={toggleDevice} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-neutral-900/20 border border-dashed border-neutral-800 rounded-2xl text-neutral-500 text-sm">
                No devices in this group yet. Click the gear icon to add some.
              </div>
            )}
          </div>
        );
      })}

      {/* Manage Group Modal */}
      {managingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-neutral-800">
              <h3 className="font-medium text-lg">Manage: {managingGroup.friendly_name}</h3>
              <button onClick={() => setManagingGroup(null)} className="text-neutral-400 hover:text-white"><X size={20} /></button>
            </div>
            
            <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
              {Object.keys(devices).map(deviceName => {
                const isInGroup = managingGroup.members.some(m => m.name === deviceName);
                return (
                  <div key={deviceName} className="flex items-center justify-between p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/50">
                    <span className="text-sm font-medium">{deviceName}</span>
                    <button
                      onClick={() => {
                        if (isInGroup) removeDeviceFromGroup(managingGroup.friendly_name, deviceName);
                        else addDeviceToGroup(managingGroup.friendly_name, deviceName);
                        
                        // Optimistically update local modal state
                        setManagingGroup(prev => {
                          if (!prev) return null;
                          const newMembers = isInGroup 
                            ? prev.members.filter(m => m.name !== deviceName)
                            : [...prev.members, { ieee_address: '', endpoint: 1, name: deviceName }];
                          return { ...prev, members: newMembers };
                        });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isInGroup ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                      }`}
                    >
                      {isInGroup ? 'Remove' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}