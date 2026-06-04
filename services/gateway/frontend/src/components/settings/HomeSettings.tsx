import React, { useState, useEffect } from 'react';

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", 
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"
];

export const HomeSettingsCard = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Backup state to allow canceling edits
  const [originalData, setOriginalData] = useState({
    nickname: 'My Smart Home',
    address: '',
    timezone: 'America/New_York'
  });

  const [form, setForm] = useState({ ...originalData });

  useEffect(() => {
    fetch('/api/home')
      .then(res => res.json())
      .then(data => {
        if (data && data.id) {
          setExists(true);
          const fetchedData = {
            nickname: data.nickname || '',
            address: data.address || '',
            timezone: data.timezone || 'America/New_York'
          };
          setOriginalData(fetchedData);
          setForm(fetchedData);
          setIsEditing(false); // Default to read-only if data exists
        } else {
          setIsEditing(true); // Force edit mode if no home is configured
        }
      })
      .catch(err => {
        console.error("Home not configured yet", err);
        setIsEditing(true);
      })
      .finally(() => setLoading(false));
  }, []);

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const method = exists ? 'PUT' : 'POST';
      const res = await fetch('/api/home', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      
      if (res.ok) {
        const data = await res.json();
        setExists(true);
        const newData = { ...form };
        
        // NWS might auto-correct timezone, so we sync it back
        if (data.timezone) newData.timezone = data.timezone;

        const res2 = await fetch('/api/home');
        if (res2.ok) {
          const updatedData = await res2.json();
          if (updatedData && updatedData.id) {
            const fetchedData = {
              nickname: updatedData.nickname || newData.nickname,
              address: updatedData.address || newData.address,
              timezone: updatedData.timezone || newData.timezone
            };
            setOriginalData(fetchedData);
            setForm(fetchedData);
            setIsEditing(false); // Default to read-only if data exists
          } else {
            setIsEditing(true); // Force edit mode if no home is configured
          }
        }
      }
    } catch (err) {
      console.error("Failed to save home data", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete your home configuration? This will disable location-aware agent features.")) return;
    
    setSaving(true);
    try {
      const res = await fetch('/api/home', { method: 'DELETE' });
      if (res.ok) {
        setExists(false);
        const resetData = {
          nickname: 'My Smart Home',
          address: '',
          timezone: 'America/New_York'
        };
        setForm(resetData);
        setOriginalData(resetData);
        setIsEditing(true); // Drop back into edit mode so they can start over
      }
    } catch (err) {
      console.error("Failed to delete home", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(originalData); // Revert all unsaved typing
    setIsEditing(false);
  };

  if (loading) return <div className="text-neutral-500 p-4">Loading configuration...</div>;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-semibold text-neutral-100">Home Profile</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Set your physical address to automatically generate localized weather tools and GPS coordinates.
          </p>
        </div>
        
        {/* Only show Edit button if data exists and we aren't currently editing */}
        {exists && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-sm font-medium text-blue-500 hover:text-blue-400 transition-colors px-3 py-1 bg-blue-500/10 rounded-lg shrink-0 ml-4"
          >
            Edit
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        
        {/* Nickname Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Home Nickname</label>
          {isEditing ? (
            <input 
              type="text" 
              value={form.nickname}
              onChange={e => setForm({...form, nickname: e.target.value})}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200"
            />
          ) : (
            <div className="text-sm font-medium text-neutral-200 py-1.5">{form.nickname || '—'}</div>
          )}
        </div>

        {/* Address Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Street Address & City</label>
          {isEditing ? (
            <input 
              type="text" 
              placeholder="e.g., 1600 Pennsylvania Avenue NW, Washington, DC"
              value={form.address}
              onChange={e => setForm({...form, address: e.target.value})}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200"
            />
          ) : (
            <div className="text-sm text-neutral-200 py-1.5">{form.address || '—'}</div>
          )}
        </div>

        {/* Timezone Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Timezone</label>
          {isEditing ? (
            <select 
              value={form.timezone}
              onChange={e => setForm({...form, timezone: e.target.value})}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200 appearance-none"
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-neutral-200 py-1.5">{form.timezone.replace('_', ' ')}</div>
          )}
        </div>

        {/* Submit / Cancel Actions (Only visible in Edit Mode) */}
        {isEditing && (
          <div className="pt-4 flex items-center gap-3">
            <button 
              type="submit" 
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Syncing...' : exists ? 'Save Changes' : 'Initialize Home Context'}
            </button>
            
            {exists && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="text-neutral-400 hover:text-neutral-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Destructive Action (Only visible in Read-Only Mode to prevent accidental clicks while saving) */}
        {exists && !isEditing && (
          <div className="pt-6 border-t border-neutral-800 mt-6">
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="text-red-500 hover:text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Reset Configuration
            </button>
          </div>
        )}
      </form>
    </div>
  );
};