// services/gateway/frontend/src/App.tsx
import { ErrorBoundary } from './components/ErrorBoundary';
import { useState, useMemo, useEffect } from 'react';
import { useDevices, type DeviceState } from './hooks/useDevices';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  Lightbulb, Zap, Thermometer, ToggleRight, Box, Gamepad2
} from 'lucide-react';
import { getDeviceCategory } from './lib/deviceUtils';
import { DeviceCategorySection } from './components/devices/DeviceCategorySection';
import type { DeviceSection } from './components/devices/DeviceCategorySection';
import { GroupsView } from './components/groups/GroupsView';
import { PairingButton } from './components/devices/PairingButton';
import { AgentChat } from './components/agent/AgentChat';
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

// Heavy functional hooks are isolated into this sub-component to ensure they remain safely suspended from execution until authentication settles
function AuthenticatedDashboard() {
  const { devices, realtime, toggleDevice, sendCommand, permitJoin, renameDevice, deleteDevice } = useDevices();
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
  const [sortMode, setSortMode] = useStoredChoice('home.sort', ['type', 'alphabetical'] as const, 'type');

  const displaySections = useMemo(() => {
    const activeDevices = Object.entries(devices)
      .filter(([name]) => name !== 'bridge')
      .map(([name, state]) => ({ name, state }));

    if (sortMode === 'alphabetical') {
      // Keys are IEEE addresses; sort by the name people see.
      const label = (d: { name: string; state: DeviceState }) => (d.state.friendly_name as string | undefined) ?? d.name;
      return [{ id: 'all', title: null, devices: activeDevices.sort((a, b) => label(a).localeCompare(label(b))) }] as DeviceSection[];
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
  }, [devices, sortMode]);

  return (
    <div className="flex flex-col-reverse md:flex-row h-[100dvh] bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      
      {/* Decoupled High-Speed Modular Navigation System */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} badges={{ routines: routineAlerts }} />

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
                {/* Sorting only applies to the device list; groups have their own order. */}
                {dashboardView === 'devices' && (
                <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800">
                  <button onClick={() => setSortMode('type')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sortMode === 'type' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}>By Type</button>
                  <button onClick={() => setSortMode('alphabetical')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sortMode === 'alphabetical' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}>A-Z</button>
                </div>
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
                  {displaySections.map(section => (
                    <DeviceCategorySection key={section.id} {...section} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
                  ))}
                </div>
              </>
            ) : (
              <GroupsView devices={devices} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
            )}
          </div>
        )}

        {activeTab === 'agent' && <AgentChat />}

        {activeTab === 'rooms' && <RoomsView devices={devices} />}

        {activeTab === 'routines' && <RoutinesView devices={devices} />}

        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">
            <SettingsView />
          </div>
        )}
        </ErrorBoundary>
      </main>
    </div>
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