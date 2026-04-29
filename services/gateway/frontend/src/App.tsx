import { useState, useMemo } from 'react';
import { useDevices } from './hooks/useDevices';
import { useSystemHealth } from './hooks/useSystemHealth';
import { 
  Home, Sparkles, Settings, PanelLeftClose, PanelLeft, Radio, Workflow,
  Lightbulb, Zap, Thermometer, ToggleRight, Box
} from 'lucide-react';
import { getDeviceCategory } from './lib/deviceUtils';
import { DeviceCategorySection } from './components/devices/DeviceCategorySection';
import type { DeviceSection } from './components/devices/DeviceCategorySection';
import { GroupsView } from './components/groups/GroupsView';

export default function App() {
  const { devices, toggleDevice, sendCommand, permitJoin, renameDevice} = useDevices();
  const healthStatus = useSystemHealth();
  
  // State for tabs and sidebar
  const [activeTab, setActiveTab] = useState<'home' | 'agent' | 'routines' | 'settings'>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // State for toggling between All Devices and Groups in the dashboard
  const [dashboardView, setDashboardView] = useState<'devices' | 'groups'>('devices');

  // Pair mode state
  const [isPairing, setIsPairing] = useState(false);

  // Sorting State
  type SortMode = 'type' | 'alphabetical';
  const [sortMode, setSortMode] = useState<SortMode>('type');

  // Unified Sorting Pipeline
  const displaySections = useMemo(() => {
    // 1. Filter out the bridge and format the array
    const activeDevices = Object.entries(devices)
      .filter(([name]) => name !== 'bridge')
      .map(([name, state]) => ({ name, state }));

    // 2. Mode: Alphabetical (Flat List)
    if (sortMode === 'alphabetical') {
      const sorted = activeDevices.sort((a, b) => a.name.localeCompare(b.name));
      return [{ 
        id: 'all', 
        title: null, 
        devices: sorted 
      }] as DeviceSection[];
    }

    // 3. Mode: By Type (Grouped List)
    if (sortMode === 'type') {
      const groups: Record<string, DeviceSection> = {
        'Lights': { id: 'lights', title: 'Lights', icon: <Lightbulb size={18} />, devices: [] },
        'Smart Plugs': { id: 'plugs', title: 'Smart Plugs', icon: <Zap size={18} />, devices: [] },
        'Sensors': { id: 'sensors', title: 'Environment', icon: <Thermometer size={18} />, devices: [] },
        'Switches': { id: 'switches', title: 'Switches', icon: <ToggleRight size={18} />, devices: [] },
        'Other': { id: 'other', title: 'Other Devices', icon: <Box size={18} />, devices: [] }
      };

      activeDevices.forEach(device => {
        const category = getDeviceCategory(device.state);
        groups[category].devices.push(device);
      });

      // Only return sections that actually have devices in them
      return Object.values(groups).filter(section => section.devices.length > 0);
    }

    return [];
  }, [devices, sortMode]);

  const handleTogglePairing = () => {
    if (isPairing) {
      permitJoin(false);
      setIsPairing(false);
    } else {
      permitJoin(true, 254); // Standard 254 seconds
      setIsPairing(true);
      // Auto-turn off the UI pulse after 254 seconds
      setTimeout(() => setIsPairing(false), 254000); 
    }
  };

  const NavItem = ({ id, icon: Icon, label }: { id: string, icon: any, label: string }) => {
    const isActive = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id as any)}
        className={`group relative flex items-center p-3 md:py-3 w-full rounded-xl transition-all duration-200 ${
          isSidebarCollapsed ? 'justify-center md:px-3' : 'justify-center md:justify-start md:px-4 gap-3'
        } ${
          isActive 
            ? 'bg-neutral-800 text-neutral-100' 
            : 'text-neutral-500 hover:bg-neutral-900/50 hover:text-neutral-300'
        }`}
      >
        <Icon size={20} className={isActive ? 'text-blue-400' : ''} />
        
        {/* Label (Hidden on Desktop when collapsed) */}
        <span className={`text-[10px] md:text-sm font-medium ${isSidebarCollapsed ? 'hidden md:hidden' : 'block'}`}>
          {label}
        </span>

        {/* Tooltip (Only visible on Desktop when collapsed) */}
        {isSidebarCollapsed && (
          <div className="hidden md:block absolute left-full ml-4 px-2.5 py-1.5 bg-neutral-800 text-neutral-200 text-xs font-medium rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 border border-neutral-700 shadow-xl">
            {label}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col-reverse md:flex-row min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      
      {/* Sidebar / Bottom Nav */}
      <nav 
        className={`border-t md:border-t-0 md:border-r border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky bottom-0 md:top-0 z-40 md:h-screen flex md:flex-col p-2 md:p-4 justify-around md:justify-start gap-1 transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'md:w-20' : 'md:w-64'
        } w-full`}
      >
        {/* Header Area */}
        <div className={`hidden md:flex items-center mb-8 px-2 py-2 ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isSidebarCollapsed && (
            <h1 className="text-xl font-medium tracking-tight whitespace-nowrap overflow-hidden">
              Smart Home os
            </h1>
          )}
          
          <div className="flex items-center gap-3">
            {/* Health Indicator with pure CSS Tooltip */}
            <div className="relative group flex items-center justify-center cursor-help">
              <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${
                healthStatus === 'healthy' ? 'bg-green-500 shadow-green-500/50' : 
                healthStatus === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 shadow-red-500/50'
              }`} />
              <div className="absolute left-full ml-3 px-2 py-1 bg-neutral-800 border border-neutral-700 text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                Gateway: {healthStatus}
              </div>
            </div>

            {/* Collapse Toggle */}
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-lg transition-colors hidden md:block"
            >
              {isSidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
        </div>

        <NavItem id="home" icon={Home} label="Home" />
        <NavItem id="agent" icon={Sparkles} label="Agent" />
        <NavItem id="routines" icon={Workflow} label="Routines" />
        
        <div className="md:mt-auto">
          <NavItem id="settings" icon={Settings} label="Settings" />
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto w-full">
        
        {/* Dashboard Tab */}
        {activeTab === 'home' && (
          <div className="animate-in fade-in duration-500">
            
            {/* Header & Toggle */}
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-medium tracking-tight">My Devices</h1>
                {/* Mobile health dot */}
                <div className={`md:hidden w-2.5 h-2.5 rounded-full ${healthStatus === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>

              {/* Dashboard Header with Toggle */}
              <div className="flex justify-between items-end mb-6">                
                <div className="flex items-center gap-1 bg-neutral-900/50 p-1 rounded-xl border border-neutral-800">
                  <button 
                    onClick={() => setSortMode('type')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sortMode === 'type' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                    By Type
                  </button>
                  <button 
                    onClick={() => setSortMode('alphabetical')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sortMode === 'alphabetical' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                    Alphabetical
                  </button>
                </div>
              </div>

              {/* View Toggle */}
              <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800 w-fit">
                <button
                  onClick={() => setDashboardView('devices')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    dashboardView === 'devices' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  All Devices
                </button>
                <button
                  onClick={() => setDashboardView('groups')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    dashboardView === 'groups' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Groups
                </button>
              </div>
            </header>

            {/* Content Routing */}
            {dashboardView === 'devices' ? (
              <>
              {/* Render the unified sections */}
              <div className="w-full">
                {displaySections.map(section => (
                  <DeviceCategorySection 
                    key={section.id} 
                    {...section} 
                    sendCommand={sendCommand} 
                    toggleDevice={toggleDevice} 
                    renameDevice={renameDevice}
                  />
                ))}
              </div>

                {/* Permit Join Floating Action Button */}
                <div className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-50 animate-in slide-in-from-bottom-8 duration-500">
                  <button
                    onClick={handleTogglePairing}
                    className={`group flex items-center gap-3 px-5 py-3.5 rounded-full shadow-2xl transition-all duration-300 border ${
                      isPairing
                        ? 'bg-blue-900/40 border-blue-500/50 text-blue-400 backdrop-blur-md'
                        : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white hover:border-neutral-600'
                    }`}
                  >
                    <div className="relative">
                      <Radio size={20} className={isPairing ? 'animate-pulse text-blue-400' : 'text-neutral-400 group-hover:text-white'} />
                      {isPairing && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-blue-500 opacity-20"></span>
                      )}
                    </div>
                    <span className="text-sm font-medium tracking-tight pr-1">
                      {isPairing ? 'Pairing Mode Active...' : 'Add Device'}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <GroupsView 
                devices={devices} 
                sendCommand={sendCommand} 
                toggleDevice={toggleDevice} 
                renameDevice={renameDevice}
              />
            )}
          </div>
        )}
        
        {/* Agent Tab (Placeholder) */}
        {activeTab === 'agent' && (
          <div className="h-[80vh] flex items-center justify-center text-neutral-500 animate-in fade-in">
            <div className="text-center">
              <Sparkles className="mx-auto mb-4 opacity-50" size={48} />
              <h2 className="text-xl font-medium text-neutral-300">Agentic Orchestrator</h2>
              <p className="mt-2 text-sm">LLM Interface coming in Phase 3.</p>
            </div>
          </div>
        )}

        {/* Routines (Placeholder) */}
        {activeTab === 'routines' && (
          <div className="h-[80vh] flex items-center justify-center text-neutral-500 animate-in fade-in">
            <div className="text-center">
              <Workflow className="mx-auto mb-4 opacity-50" size={48} />
              <h2 className="text-xl font-medium text-neutral-300">Routine Orchestrator</h2>
              <p className="mt-2 text-sm">Routine orchestration coming in Phase 4</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}