// services/gateway/frontend/src/components/settings/SettingsView.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

// Premium minimalist custom brand iconography path definitions
const SpotifyLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-[#1DB954]" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.894-.982-.336.074-.67-.142-.744-.48-.074-.336.143-.67.48-.743 3.856-.88 7.15-.503 9.81 1.128.296.18.387.563.208.86zm1.224-2.724c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.08-1.182-.413.125-.85-.107-.975-.522-.125-.413.107-.85.522-.975 3.678-1.117 8.246-.575 11.346 1.332.366.227.486.707.26 1.075zm.11-2.845C14.452 8.71 8.77 8.52 5.477 9.52c-.53.16-1.09-.14-1.25-.67-.16-.53.14-1.09.67-1.25 3.77-1.14 10.03-.92 14.04 1.46.48.28.64.9.36 1.38-.28.48-.9.64-1.38.36z"/>
  </svg>
);

const OpenAILogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-purple-400" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.322 10.19a4.872 4.872 0 0 0-.416-2.228 4.93 4.93 0 0 0-1.637-1.921 4.908 4.908 0 0 0-1.255-.656 4.93 4.93 0 0 0-2.336-.089 4.896 4.896 0 0 0-2.036-1.5 4.954 4.954 0 0 0-3.328 0 4.896 4.896 0 0 0-2.036 1.5A4.93 4.93 0 0 0 5.94 5.385a4.908 4.908 0 0 0-1.255-.656 4.93 4.93 0 0 0-1.637 1.92 4.872 4.872 0 0 0-.416 2.229 4.92 4.92 0 0 0 .157 2.261A4.93 4.93 0 0 0 4.43 14.37a4.908 4.908 0 0 0 1.255.656 4.93 4.93 0 0 0 2.336.089 4.896 4.896 0 0 0 2.036 1.5 4.954 4.954 0 0 0 3.328 0 4.896 4.896 0 0 0 2.036-1.5 4.93 4.93 0 0 0 2.338-.089 4.908 4.908 0 0 0 1.255-.656 4.93 4.93 0 0 0 1.637-1.92 4.872 4.872 0 0 0 .416-2.229 4.92 4.92 0 0 0-.157-2.261zm-10.46 8.53a2.91 2.91 0 0 1-1.32-.486l3.54-2.045a.516.516 0 0 0 .257-.447v-4.93l1.455.84a.042.042 0 0 1 .022.031v4.067a2.935 2.935 0 0 1-3.954 2.97zm-5.89-4.22a2.91 2.91 0 0 1-.225-1.39l3.54 2.044a.516.516 0 0 0 .513 0l4.27-2.464v1.68a.042.042 0 0 1-.013.036l-3.522 2.034a2.935 2.935 0 0 1-4.113-.94zm-.952-6.52a2.91 2.91 0 0 1 1.096-.904l.004 4.09a.516.516 0 0 0 .257.446l4.27 2.465-1.454.84a.042.042 0 0 1-.035.004l-3.522-2.034a2.935 2.935 0 0 1-.616-3.907zM11.66 4.41a2.91 2.91 0 0 1 1.32.486l-3.54 2.045a.516.516 0 0 0-.257.447v4.93l-1.455-.84a.042.042 0 0 1-.022-.031V7.38a2.935 2.935 0 0 1 3.954-2.97zm5.89 4.22a2.91 2.91 0 0 1 .225 1.39l-3.54-2.044a.516.516 0 0 0-.513 0L9.452 10.44V8.76a.042.042 0 0 1 .013-.036l3.522-2.034a2.935 2.935 0 0 1 4.113.94zm.952 6.52a2.91 2.91 0 0 1-1.096.904l-.004-4.09a.516.516 0 0 0-.257-.446l-4.27-2.465 1.455-.84a.042.042 0 0 1 .035-.004l3.522 2.034a2.935 2.935 0 0 1 .616 3.907zM12 13.064l-2.435-1.406V8.844L12 7.438l2.435 1.406v2.814L12 13.064z"/>
  </svg>
);

export function SettingsView() {
  const { user, logout, authenticatedFetch } = useAuth();
  const [settingsTab, setSettingsTab] = useState<'account' | 'connections' | 'admin'>('account');
  
  // User Profile Form Handlers
  const [username, setUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [profileStatus, setProfileStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Credential Vault State Management
  const [activeVaultProvider, setActiveVaultProvider] = useState<'openai' | null>(null);
  const [vaultSecret, setVaultSecret] = useState('');
  const [vaultStatus, setVaultStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [connectedServices, setConnectedServices] = useState<{spotify: boolean, openai: boolean}>({ spotify: false, openai: false });

  // Fetch integration status when opening the connections tab
  useEffect(() => {
    if (settingsTab === 'connections') {
      fetchIntegrationStatus();
    }
  }, [settingsTab]);

  const fetchIntegrationStatus = async () => {
    try {
      const res = await authenticatedFetch('/api/integrations/status');
      const data = await res.json();
      if (data) setConnectedServices(data);
    } catch (err) {
      console.error("Failed to fetch integration status", err);
    }
  };
  
  // Logout overlay tracking state
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (user?.username) {
      setUsername(user.username);
    }
  }, [user]);

  // Check for Spotify OAuth callback on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    // If we detect a code, it means we just returned from Spotify
    if (code) {
      setSettingsTab('connections');
      handleSpotifyCallback(code, state);
    }
  }, []); 

  const handleSpotifyCallback = async (code: string, state: string | null) => {
    setVaultStatus({ type: 'success', message: 'Connecting to Spotify...' });
    
    try {
      const res = await authenticatedFetch('/api/integrations/spotify/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      });

      if (res.ok) {
        setVaultStatus({ type: 'success', message: 'Spotify linked successfully! Agent is ready to DJ.' });
        // Clean up the URL so it doesn't try to re-authenticate on refresh
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const data = await res.json();
        setVaultStatus({ type: 'error', message: data.detail || 'Spotify linking failed.' });
      }
    } catch (err) {
      setVaultStatus({ type: 'error', message: 'Network error during Spotify link.' });
    }
  };

  const handleSpotifyLogin = async () => {
    setVaultStatus({ type: 'success', message: 'Requesting secure link from Gateway...' });
    try {
      const res = await authenticatedFetch('/api/integrations/spotify/auth-url');
      
      // Check if using standard fetch or axios
      const data = await res.json(); 
      console.log("Spotify Auth Data:", data);

      if (data && data.auth_url) {
        window.location.href = data.auth_url; // This forces the browser to redirect
      } else {
        setVaultStatus({ type: 'error', message: 'Gateway did not return a valid auth_url.' });
      }
    } catch (err) {
      console.error("Spotify Link Error:", err);
      setVaultStatus({ type: 'error', message: 'Network error communicating with gateway.' });
    }
  };

  const handleDisconnect = async (provider: string) => {
    setVaultStatus({ type: 'success', message: `Disconnecting ${provider}...` });
    try {
      const res = await authenticatedFetch(`/api/integrations/${provider}`, { method: 'DELETE' });
      if (res.ok || res.status === 200) {
        setVaultStatus({ type: 'success', message: `${provider} successfully disconnected.` });
        fetchIntegrationStatus(); // Refresh the UI state
      }
    } catch (err) {
      setVaultStatus({ type: 'error', message: `Failed to disconnect ${provider}.` });
    }
  };

  // Phase 2: Profile Syncing & Sanitation Check
  const handleSaveProfile = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileStatus(null);
    
    if (!username.trim()) {
      setProfileStatus({ type: 'error', message: 'Username cannot be left blank.' });
      return;
    }

    try {
      const res = await authenticatedFetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          ...(newPassword ? { password: newPassword } : {})
        }),
      });

      if (res.ok) {
        setProfileStatus({ type: 'success', message: 'Identity modifications pushed correctly.' });
        setNewPassword('');
        setTimeout(() => setProfileStatus(null), 4000);
      } else {
        const data = await res.json();
        setProfileStatus({ type: 'error', message: data.detail || 'Identity update rejected by validator.' });
      }
    } catch {
      setProfileStatus({ type: 'error', message: 'Failed to sync identity updates with database context.' });
    }
  };

  // Phase 1: Vault Token Execution Pipeline (For manual keys like OpenAI)
  const handleSaveVault = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeVaultProvider) return;
    setVaultStatus(null);

    try {
      const res = await authenticatedFetch('/api/platform/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeVaultProvider,
          encrypted_credentials: vaultSecret.trim()
        }),
      });

      if (res.ok) {
        setVaultStatus({ type: 'success', message: 'Secret token bound securely into relational engine.' });
        setVaultSecret('');
        setTimeout(() => {
          setVaultStatus(null);
          setActiveVaultProvider(null);
        }, 1500);
      } else {
        const data = await res.json();
        setVaultStatus({ type: 'error', message: data.detail || 'Failed to save integration secrets.' });
      }
    } catch {
      setVaultStatus({ type: 'error', message: 'Network configuration error during token mutation.' });
    }
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-4xl w-full">
      <header className="mb-8">
        <h1 className="text-2xl font-medium tracking-tight">System Settings</h1>
        <p className="text-sm text-neutral-500 mt-1">Manage user identity credentials, coordinate external integrations, and access admin consoles.</p>
      </header>

      {/* Sub-tab Navigation Switcher */}
      <div className="flex border-b border-neutral-800 mb-6 gap-6 text-sm font-medium">
        <button 
          onClick={() => setSettingsTab('account')} 
          className={`pb-3 transition-colors relative ${settingsTab === 'account' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          Account Setup
        </button>
        <button 
          onClick={() => setSettingsTab('connections')} 
          className={`pb-3 transition-colors relative ${settingsTab === 'connections' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          External Connections
        </button>
        <button 
          onClick={() => setSettingsTab('admin')} 
          className={`pb-3 transition-colors relative ${settingsTab === 'admin' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          Admin Console
        </button>
      </div>

      {/* Section 1: Account Context Management */}
      {settingsTab === 'account' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <form onSubmit={handleSaveProfile} className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4">
            <h2 className="text-base font-medium text-neutral-200">Update Profile Fields</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Username</label>
                <input 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">New Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors" 
                />
              </div>
            </div>

            {profileStatus && (
              <div className={`p-3.5 rounded-lg text-xs ${profileStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {profileStatus.message}
              </div>
            )}

            <button type="submit" className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]">
              Save Profile Changes
            </button>
          </form>

          <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-medium text-neutral-200">Log Out of System</h2>
              <p className="text-xs text-neutral-500 mt-0.5">Safely terminate your active web session context on this local device display panel.</p>
            </div>
            <button 
              onClick={() => setShowLogoutConfirm(true)} 
              className="px-4 py-2 bg-red-950/40 hover:bg-red-900/30 text-red-400 border border-red-900/50 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]"
            >
              Disconnect Session
            </button>
          </div>
        </div>
      )}

      {/* Section 2: Premium External Vault Binding */}
      {settingsTab === 'connections' && (
        <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
          <h2 className="text-base font-medium text-neutral-200">External Cloud Integration Secrets</h2>
          <p className="text-xs text-neutral-500 leading-relaxed">Securely establish identity links with external resource providers to empower your local agentic reasoning capabilities.</p>
          
          {/* Status banner for Spotify redirects */}
          {vaultStatus && (
            <div className={`p-3 rounded-lg text-xs ${vaultStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {vaultStatus.message}
            </div>
          )}

          <div className="space-y-3 pt-2">

            {/* Spotify OAuth Flow */}
            <div className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center rounded-lg border border-neutral-800">
                  <SpotifyLogo />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-neutral-200">Spotify Music Link</h3>
                    {/* Render a green 'Connected' badge if true */}
                    {connectedServices.spotify && (
                      <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-md border border-green-400/20">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Linked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">Allows your home helper agent to automatically command network media playback items.</p>
                </div>
              </div>
              
              {connectedServices.spotify ? (
                <button 
                  onClick={() => handleDisconnect('spotify')}
                  className="text-xs px-3 py-1.5 bg-red-950/40 border border-red-900/50 hover:bg-red-900/40 text-red-400 rounded-lg font-medium transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={handleSpotifyLogin}
                  className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg font-medium transition-colors"
                >
                  Link Account
                </button>
              )}
            </div>

            {/* OpenAI Standard Key Vault Flow */}
            <div className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center rounded-lg border border-neutral-800">
                  <OpenAILogo />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-neutral-200">OpenAI Credentials Vault</h3>
                    {connectedServices.openai && (
                      <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-md border border-green-400/20">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full" /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">Links secure developer platform API tokens into your local chat orchestrator loop.</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                {connectedServices.openai && (
                  <button 
                    onClick={() => handleDisconnect('openai')}
                    className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-red-900/40 hover:text-red-400 hover:border-red-900/50 text-neutral-400 rounded-lg font-medium transition-colors"
                  >
                    Delink
                  </button>
                )}
                <button 
                  onClick={() => { setActiveVaultProvider('openai'); setVaultSecret(''); setVaultStatus(null); }}
                  className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg font-medium transition-colors"
                >
                  {connectedServices.openai ? 'Update Key' : 'Configure Keys'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 3: Static Isolation Admin Console */}
      {settingsTab === 'admin' && (
        <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 border-b border-neutral-800 pb-3 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-md">Root Operator</span>
            <h2 className="text-base font-medium text-neutral-200">Administrative Configuration</h2>
          </div>
          <p className="text-xs text-neutral-500 leading-relaxed">Advanced controls and system configurations reserved for internal system deployment oversight.</p>
          <p className="text-xs text-neutral-500 leading-relaxed">This section is intentionally left minimal as the current system iteration does not expose any adjustable parameters to end users.</p>
        </div>
      )}

      {/* Slide-over Drawer Layer Panel (Now only used for OpenAI) */}
      {activeVaultProvider && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200" onClick={() => setActiveVaultProvider(null)} />
          <div className="absolute inset-y-0 right-0 pl-10 max-w-full flex">
            <div className="w-screen max-w-md bg-neutral-900 border-l border-neutral-800 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300">
              <div className="space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
                  <h3 className="text-lg font-medium text-neutral-100 flex items-center gap-2.5">
                    <OpenAILogo />
                    Configure OpenAI Keys
                  </h3>
                  <button onClick={() => setActiveVaultProvider(null)} className="text-neutral-500 hover:text-neutral-300 text-sm font-medium">✕</button>
                </div>
                
                <form onSubmit={handleSaveVault} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                      API Key String
                    </label>
                    <input 
                      type="password" 
                      value={vaultSecret}
                      onChange={(e) => setVaultSecret(e.target.value)}
                      placeholder="sk-proj-••••••••"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors"
                      required
                    />
                    <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
                      This credential payload is saved into the application's secure PostgreSQL relational vault layer with standard cryptographic isolation.
                    </p>
                  </div>

                  {vaultStatus && (
                    <div className={`p-3 rounded-lg text-xs ${vaultStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {vaultStatus.message}
                    </div>
                  )}

                  <div className="flex gap-3 justify-end pt-4 border-t border-neutral-800">
                    <button type="button" onClick={() => setActiveVaultProvider(null)} className="px-4 py-2 bg-neutral-950 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 text-xs font-medium rounded-xl transition-colors">
                      Cancel
                    </button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-xl transition-colors active:scale-[0.99]">
                      Save Encrypted Key
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safety Logout Overlay Confirmation Sheet */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
            <h3 className="text-lg font-medium text-neutral-100">Confirm Disconnection</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">Are you completely sure you want to log out of your Smart Home OS cluster? You will be required to input credentials again to re-authenticate.</p>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowLogoutConfirm(false)} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-xl transition-colors active:scale-[0.99]">
                Confirm Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}