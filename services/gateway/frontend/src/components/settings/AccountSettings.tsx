import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

export function AccountSettings() {
  const { user, logout, authenticatedFetch, refreshUser } = useAuth();
  
  // Profile State
  const [username, setUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [profileStatus, setProfileStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Modal States
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (user?.username) {
      setUsername(user.username);
    }
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileStatus(null);
    
    if (!username.trim()) {
      setProfileStatus({ type: 'error', message: 'Username cannot be left blank.' });
      return;
    }

    try {
      const res = await authenticatedFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          ...(newPassword ? { password: newPassword } : {})
        }),
      });

      if (res.ok) {
        setProfileStatus({ type: 'success', message: 'Saved.' });
        setNewPassword('');
        setIsEditing(false); // Drop back to static view on success
        await refreshUser(); // Pull the new username into AuthContext (header, settings view)
        setTimeout(() => setProfileStatus(null), 4000);
      } else {
        const data = await res.json();
        // FastAPI validation errors (422) return detail as an array of {msg, ...}
        const detail = Array.isArray(data.detail)
          ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(' ')
          : data.detail;
        setProfileStatus({ type: 'error', message: detail || 'Couldn’t save your changes.' });
      }
    } catch {
      setProfileStatus({ type: 'error', message: 'Couldn’t reach the hub. Your changes weren’t saved.' });
    }
  };

  const handleCancelEdit = () => {
    setUsername(user?.username || ''); // Revert unsaved changes
    setNewPassword('');
    setIsEditing(false);
    setProfileStatus(null);
  };

  const handleDeleteAccount = async () => {
    try {
      const res = await authenticatedFetch('/api/auth/me', {
        method: 'DELETE'
      });

      if (res.ok) {
        // Clear frontend context and redirect to login
        logout();
      } else {
        const data = await res.json();
        setProfileStatus({ type: 'error', message: data.detail || 'Couldn’t delete the account.' });
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      setProfileStatus({ type: 'error', message: 'Couldn’t reach the hub. Try again.' });
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Dynamic Profile Section */}
      {!isEditing ? (
        <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-neutral-200">Account Details</h2>
            <div className="mt-2 space-y-1">
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Username</p>
              <p className="text-sm text-neutral-300">{user?.username}</p>
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Password</p>
              <p className="text-sm text-neutral-300">••••••••</p>
            </div>
          </div>
          <button 
            onClick={() => setIsEditing(true)} 
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99] self-start sm:self-center"
          >
            Edit
          </button>
        </div>
      ) : (
        <form onSubmit={handleSaveProfile} className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4">
          <h2 className="text-base font-medium text-neutral-200">Edit account</h2>
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
              <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">New password (leave blank to keep)</label>
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

          <div className="flex gap-3 pt-2">
            <button type="submit" className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]">
              Save
            </button>
            <button type="button" onClick={handleCancelEdit} className="px-4 py-2 bg-transparent hover:bg-neutral-800/50 text-neutral-400 text-xs font-medium rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Disconnect Session */}
      <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-neutral-200">Log out</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Sign out on this device. You’ll stay signed in everywhere else.</p>
        </div>
        <button 
          onClick={logout}
          className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]"
        >
          Log Out
        </button>
      </div>

      {/* Danger Zone: Delete Account */}
      <div className="bg-red-950/10 border border-red-900/30 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-red-400">Danger Zone</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Delete your account, settings and linked accounts (Spotify, API key). This can’t be undone.</p>
        </div>
        <button 
          onClick={() => setShowDeleteConfirm(true)} 
          className="px-4 py-2 bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-900/50 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]"
        >
          Delete Account
        </button>
      </div>

      {/* ---------------- MODALS ---------------- */}


      {/* Delete Account Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-950 border border-red-900/50 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
            <h3 className="text-lg font-semibold text-red-500">Delete your account?</h3>
            <p className="text-sm text-neutral-300 leading-relaxed">This <span className="font-bold text-red-400">can’t be undone</span>. Your settings, saved API key and Spotify link will be deleted.</p>
            <div className="flex gap-3 justify-end pt-4">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={handleDeleteAccount} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-xl transition-colors active:scale-[0.99]">
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}