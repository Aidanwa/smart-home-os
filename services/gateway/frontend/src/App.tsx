// services/gateway/frontend/src/App.tsx
import { ErrorBoundary } from './components/ErrorBoundary';
import { useState, useMemo, useEffect, type ComponentProps } from 'react';
import { useDevices, type DeviceState } from './hooks/useDevices';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  Lightbulb, Zap, Thermometer, ToggleRight, Box, Gamepad2, DoorOpen, MapPinOff, PowerOff, ChevronDown, Plug, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { getDeviceCategory, getDeviceKind } from './lib/deviceUtils';
import { useRoomIndex } from './hooks/useRoomIndex';
import { formatFloorName } from './components/rooms/constants';
import { DeviceCategorySection } from './components/devices/DeviceCategorySection';
import type { DeviceSection } from './components/devices/DeviceCategorySection';
import { GroupsView } from './components/groups/GroupsView';
import { PairingButton } from './components/devices/PairingButton';
import { AgentChat } from './components/agent/AgentChat';
import { AgentChatProvider, useAgentChat } from './hooks/useAgentChat';
import { LoginCard } from './components/auth/LoginCard';
import { Sidebar } from './components/layout/Sidebar';
import { ConnectionBanner } from './components/layout/ConnectionBanner';
import { SettingsView } from './components/settings/SettingsView';
import { RoomsView } from './components/rooms/RoomsView';
import { RoutinesView } from './components/routines/RoutinesView';
import { useRoutineAlerts } from './hooks/useRoutines';

const TABS = ['home', 'agent', 'rooms', 'routines', 'settings'] as const;
type Tab = typeof TABS[number];

/** The tab lives in the URL hash (#routines), so refresh, Back and links work. Spotify's
 *  sign-in comes back with ?code=..., which Settings handles, so land there. */
function tabFromUrl(): Tab {
  if (new URLSearchParams(window.location.search).has('code')) return 'settings';
  const h = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'home';
}

/** A choice from a fixed list, remembered in localStorage (per device; harmless if unavailable). */
function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return options.includes(v as T) ? (v as T) : fallback;
    } catch { return fallback; }
  });
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* private mode */ }
  };
  return [value, set] as const;
}

/** The nav, with a dot on Agent when a reply arrived while you were on another tab. */
function Nav(props: ComponentProps<typeof Sidebar>) {
  const { unread } = useAgentChat();
  return <Sidebar {...props} dots={unread ? { agent: 'New reply from the assistant' } : {}} />;
}

// Heavy functional hooks are isolated into this sub-component to ensure they remain safely suspended from execution until authentication settles
function AuthenticatedDashboard() {
  const { devices, loadState, reloadDevices, realtime, toggleDevice, sendCommand, permitJoin, renameDevice, deleteDevice } = useDevices();
  const { user } = useAuth();
  
  const [activeTab, setTabState] = useState<Tab>(tabFromUrl);
  useEffect(() => {
    const onHash = () => setTabState(tabFromUrl());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Each tab change is a history entry (via hashchange), so the phone's Back goes to the previous tab.
  const setActiveTab = (tab: Tab) => {
    if (tab === activeTab) return;
    window.location.hash = tab;
  };
  const routineAlerts = useRoutineAlerts(activeTab === 'routines');
  // Home's view and sort choices are remembered on this device.
  const [dashboardView, setDashboardView] = useStoredChoice('home.view', ['devices', 'groups'] as const, 'devices');
  const [sortMode, setSortMode] = useStoredChoice('home.sort', ['type', 'room', 'alphabetical'] as const, 'type');
  const roomIndex = useRoomIndex(activeTab === 'home' && dashboardView === 'devices' && sortMode === 'room');

  const displaySections = useMemo(() => {
    const activeDevices = Object.entries(devices)
      .filter(([name]) => name !== 'bridge')
      .map(([name, state]) => ({ name, state }));

    // Keys are IEEE addresses; sort by the name people see.
    const label = (d: { name: string; state: DeviceState }) => (d.state.friendly_name as string | undefined) ?? d.name;
    if (sortMode === 'alphabetical') {
      return [{ id: 'all', title: null, devices: activeDevices.sort((a, b) => label(a).localeCompare(label(b))) }] as DeviceSection[];
    }

    if (sortMode === 'room') {
      if (!roomIndex) return [];  // still loading the floor plan
      const multiFloor = new Set(roomIndex.rooms.map(r => r.floor)).size > 1;
      const sections: DeviceSection[] = roomIndex.rooms.map(r => ({
        id: `room-${r.id}`, title: multiFloor ? `${r.name} · ${formatFloorName(r.floor)}` : r.name, icon: <DoorOpen size={18} />, devices: [],
      }));
      const byId = new Map(roomIndex.rooms.map((r, i) => [r.id, sections[i]]));
      const unplaced: DeviceSection = { id: 'room-none', title: 'Not in a room', icon: <MapPinOff size={18} />, devices: [] };
      activeDevices.sort((a, b) => label(a).localeCompare(label(b))).forEach(d => {
        const room = roomIndex.roomOf[d.state.ieee_address ?? d.name];
        ((room && byId.get(room)) || unplaced).devices.push(d);
      });
      return [...sections, unplaced].filter(s => s.devices.length > 0);
    }

    const groups: Record<string, DeviceSection> = {
      'Lights': { id: 'lights', title: 'Lights', icon: <Lightbulb size={18} />, devices: [] },
      'Smart Plugs': { id: 'plugs', title: 'Smart Plugs', icon: <Zap size={18} />, devices: [] },
      'Sensors': { id: 'sensors', title: 'Sensors', icon: <Thermometer size={18} />, devices: [] },
      'Remotes': { id: 'remotes', title: 'Remotes', icon: <Gamepad2 size={18} />, devices: [] },
      'Switches': { id: 'switches', title: 'Switches', icon: <ToggleRight size={18} />, devices: [] },
      'Other': { id: 'other', title: 'Other Devices', icon: <Box size={18} />, devices: [] }
    };

    activeDevices.forEach(device => {
      const category = getDeviceCategory(device.state);
      groups[category].devices.push(device);
    });

    return Object.values(groups).filter(section => section.devices.length > 0);
  }, [devices, sortMode, roomIndex]);

  // "Lights off" for a section. Lights only: plugs often run things that
  // shouldn't be cut (a fridge, the router). Undo turns the same lights back on.
  const lightsOn = (list: Array<{ name: string; state: DeviceState }>) =>
    list.filter(d => getDeviceKind(d.state) === 'light' && d.state.state === 'ON')
      .map(d => (d.state.friendly_name as string | undefined) ?? d.name);
  const setLights = async (names: string[], on: boolean) => {
    const ok = await Promise.all(names.map(n => sendCommand(n, { state: on ? 'ON' : 'OFF' }, `turn ${on ? 'on' : 'off'} ${n}`)));
    return names.filter((_, i) => ok[i]);
  };
  const lightsOff = async (names: string[], where: string) => {
    const done = await setLights(names, false);
    if (done.length) toast.success(`Turned off ${done.length} light${done.length === 1 ? '' : 's'}${where}`, {
      action: { label: 'Undo', onClick: () => { setLights(done, true); } },
    });
  };
  const sectionAction = (section: DeviceSection) => {
    const names = lightsOn(section.devices);
    if (names.length === 0 || !section.title) return undefined;
    const where = section.id.startsWith('room-') && section.id !== 'room-none' ? ` in ${section.title}` : '';
    return (
      <button onClick={() => lightsOff(names, where)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800">
        <PowerOff size={13} /> Lights off
      </button>
    );
  };
  const deviceCount = Object.keys(devices).filter(k => k !== 'bridge').length;

  return (
    // The chat lives here, above the tabs, so a reply keeps coming while you look elsewhere.
    <AgentChatProvider visible={activeTab === 'agent'}>
    <div className="flex flex-col-reverse md:flex-row h-[100dvh] bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      
      {/* Decoupled High-Speed Modular Navigation System */}
      <Nav activeTab={activeTab} setActiveTab={setActiveTab} badges={{ routines: routineAlerts }} />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden w-full relative">
        <ConnectionBanner status={realtime} />

        {/* A crash inside one tab shows a message there instead of blanking the app.
            Keyed by tab, so switching tabs gives the broken one a fresh start. */}
        <ErrorBoundary key={activeTab} label={`${activeTab} tab`}>
        {activeTab === 'home' && (
          // CHANGED: Moved the padding and scroll into the specific home container
          <div className="flex-1 overflow-y-auto p-6 md:p-10 animate-in fade-in duration-500">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
              <h1 className="text-2xl font-medium tracking-tight">Welcome back, {user?.username}</h1>
              <div className="flex flex-wrap items-center gap-2">
                {/* Grouping only applies to the device list; groups have their own order. */}
                {dashboardView === 'devices' && (
                  <label className="relative flex items-center">
                    <span className="sr-only">Group devices</span>
                    <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                      className="appearance-none h-10 pl-3 pr-8 rounded-xl bg-neutral-900/50 border border-neutral-800 text-sm font-medium text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                      <option value="type">By type</option>
                      <option value="room">By room</option>
                      <option value="alphabetical">A–Z</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-2.5 text-neutral-500 pointer-events-none" />
                  </label>
                )}
                <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800">
                  <button onClick={() => setDashboardView('devices')} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${dashboardView === 'devices' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>Devices</button>
                  <button onClick={() => setDashboardView('groups')} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${dashboardView === 'groups' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>Groups</button>
                </div>
                <PairingButton devices={devices} permitJoin={permitJoin} />
              </div>
            </header>

            {dashboardView === 'devices' ? (
              <>
                <div className="w-full pb-6">
                  {loadState === 'loading' || (sortMode === 'room' && !roomIndex && deviceCount > 0) ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading devices">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-[104px] rounded-2xl border border-neutral-800/60 bg-neutral-900/40 p-4 flex gap-4 animate-pulse">
                          <div className="size-11 rounded-xl bg-neutral-800" />
                          <div className="flex-1 space-y-2.5 pt-1">
                            <div className="h-3.5 w-2/3 rounded bg-neutral-800" />
                            <div className="h-3 w-1/3 rounded bg-neutral-800/70" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : loadState === 'error' && deviceCount === 0 ? (
                    <div className="max-w-md mx-auto mt-10 text-center space-y-3 p-6 rounded-2xl border border-neutral-800 bg-neutral-900/40">
                      <p className="text-neutral-200 font-medium">Couldn’t load your devices</p>
                      <p className="text-sm text-neutral-500">The hub didn’t answer. Check that it’s running and you’re connected.</p>
                      <button onClick={reloadDevices} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-medium">
                        <RefreshCw size={15} /> Try again
                      </button>
                    </div>
                  ) : deviceCount === 0 ? (
                    <div className="max-w-md mx-auto mt-10 text-center space-y-3 p-6 rounded-2xl border border-dashed border-neutral-800">
                      <Plug size={28} className="mx-auto text-neutral-600" />
                      <p className="text-neutral-200 font-medium">No devices yet</p>
                      <p className="text-sm text-neutral-500">Tap <strong className="text-neutral-300">Add device</strong> above, then put the device into pairing mode (often a long press, or switching it off and on a few times).</p>
                    </div>
                  ) : (
                    <>
                      {sortMode === 'room' && roomIndex && roomIndex.rooms.length === 0 && (
                        <p className="mb-6 text-sm text-neutral-500">No rooms yet. Draw them in the <a href="#rooms" className="text-neutral-300 underline">Rooms</a> tab and put devices in them.</p>
                      )}
                      {displaySections.map(section => (
                        <DeviceCategorySection key={section.id} {...section} action={sectionAction(section)} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
                      ))}
                    </>
                  )}
                </div>
              </>
            ) : (
              <GroupsView devices={devices} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
            )}
          </div>
        )}

        {activeTab === 'agent' && <AgentChat />}

        {activeTab === 'rooms' && <RoomsView devices={devices} toggleDevice={toggleDevice} />}

        {activeTab === 'routines' && <RoutinesView devices={devices} />}

        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">
            <SettingsView />
          </div>
        )}
        </ErrorBoundary>
      </main>
    </div>
    </AgentChatProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-400 font-mono">Loading…</div>;
  return isAuthenticated ? <AuthenticatedDashboard /> : <LoginCard />;
}