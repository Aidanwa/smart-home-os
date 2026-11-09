import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../ui/dialog';
import { toast } from 'sonner';
import { request } from '../../lib/api';

export function AccountSettings() {
  const { user, logout, authenticatedFetch, refreshUser } = useAuth();
  
  // Profile State
  const [username, setUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
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
    if (!username.trim()) {
      toast.error('Username can’t be blank.');
      return;
    }
    setSaving(true);
    const ok = await request('save your account', () => authenticatedFetch('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.trim(),
        ...(newPassword ? { password: newPassword } : {})
      }),
    }));
    setSaving(false);
    if (!ok) return;
    toast.success(newPassword ? 'Username and password saved' : 'Account saved');
    setNewPassword('');
    setIsEditing(false); // Drop back to static view on success
    await refreshUser(); // Pull the new username into AuthContext (header, settings view)
  };

  const handleCancelEdit = () => {
    setUsername(user?.username || ''); // Revert unsaved changes
    setNewPassword('');
    setIsEditing(false);
  };

  // Throwing keeps the confirm dialog open after a failure (the toast says why).
  const handleDeleteAccount = async () => {
    const ok = await request('delete your account', () => authenticatedFetch('/api/auth/me', { method: 'DELETE' }));
    if (!ok) throw new Error('not deleted');
    logout();
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

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
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

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete your account?"
        description={<>This <span className="font-semibold text-red-400">can’t be undone</span>. Your settings, saved API key and Spotify link will be deleted.</>}
        confirmLabel="Delete account"
        busyLabel="Deleting…"
        destructive
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}