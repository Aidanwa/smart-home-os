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
  const [error, setError] = useState('');
  
  // Keep the core state tied cleanly to the database structure
  const [originalData, setOriginalData] = useState({
    nickname: 'My Smart Home',
    address: '',
    timezone: 'America/New_York',
    bottom_floor: 1,
    top_floor: 1
  });

  const [form, setForm] = useState({ ...originalData });

  // Compute presentation layer abstractions from the underlying floor numbers
  const hasBasement = form.bottom_floor === 0;
  const totalFloorsAboveGround = form.top_floor;

  useEffect(() => {
    fetch('/api/home')
      .then(res => res.json())
      .then(data => {
        if (data && data.id) {
          setExists(true);
          const fetchedData = {
            nickname: data.nickname || '',
            address: data.address || '',
            timezone: data.timezone || 'America/New_York',
            bottom_floor: data.bottom_floor ?? 1,
            top_floor: data.top_floor ?? 1
          };
          setOriginalData(fetchedData);
          setForm(fetchedData);
          setIsEditing(false);
        } else {
          setIsEditing(true);
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
    setError('');
    setSaving(true);
    
    try {
      const method = exists ? 'PUT' : 'POST';
      const res = await fetch('/api/home', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form) // State matches the expected backend DB contract perfectly
      });
      
      if (res.ok) {
        const data = await res.json();
        setExists(true);
        
        const fetchedData = {
          nickname: data.nickname || '',
          address: data.address || '',
          timezone: data.timezone || 'America/New_York',
          bottom_floor: data.bottom_floor ?? 1,
          top_floor: data.top_floor ?? 1
        };
        setOriginalData(fetchedData);
        setForm(fetchedData);
        setIsEditing(false);
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to update context.');
      }
    } catch (err) {
      console.error("Failed to save home data", err);
      setError('Network or system validation failure.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(originalData);
    setError('');
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete your home configuration? This will disable layout-aware spatial layers.")) return;
    
    setSaving(true);
    try {
      const res = await fetch('/api/home', { method: 'DELETE' });
      if (res.ok) {
        setExists(false);
        const resetData = {
          nickname: 'My Smart Home',
          address: '',
          timezone: 'America/New_York',
          bottom_floor: 1,
          top_floor: 1
        };
        setForm(resetData);
        setOriginalData(resetData);
        setIsEditing(true);
      }
    } catch (err) {
      console.error("Failed to delete home", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-neutral-500 p-4">Loading configuration...</div>;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-semibold text-neutral-100">Home Profile</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Set your physical address and house limits to automatically generate localized micro-features.
          </p>
        </div>
        
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

      <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
        {error && <div className="p-3 text-xs bg-red-950/50 border border-red-900 text-red-400 rounded-lg">{error}</div>}

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

        {/* Visual & Interactive Layout Configuration Options */}
        <div className="bg-neutral-950/50 border border-neutral-800/80 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">How many floors is your house? <span className="text-neutral-500">(Excluding basement)</span></label>
            {isEditing ? (
              <select
                value={totalFloorsAboveGround}
                onChange={e => {
                  const targetTop = parseInt(e.target.value) || 1;
                  setForm({ ...form, top_floor: targetTop });
                }}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200"
              >
                {[1, 2, 3, 4, 5].map(num => (
                  <option key={num} value={num}>{num} {num === 1 ? 'Floor' : 'Floors'}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-neutral-200 py-1">{totalFloorsAboveGround} {totalFloorsAboveGround === 1 ? 'Floor' : 'Floors'}</div>
            )}
          </div>

          <div className="flex items-center">
            {isEditing ? (
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input 
                  type="checkbox"
                  checked={hasBasement}
                  onChange={e => {
                    setForm({ ...form, bottom_floor: e.target.checked ? 0 : 1 });
                  }}
                  className="w-4 h-4 rounded border-neutral-800 bg-neutral-950 text-blue-600 focus:ring-0 accent-blue-500 outline-none"
                />
                <span className="text-sm text-neutral-300">Is there a basement?</span>
              </label>
            ) : (
              <div className="text-sm text-neutral-400">
                Basement: <span className="text-neutral-200 font-medium ml-1">{hasBasement ? 'Yes' : 'No'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timezone Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Timezone</label>
          {isEditing ? (
            <select 
              value={form.timezone}
              onChange={e => setForm({...form, timezone: e.target.value})}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200"
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-neutral-200 py-1.5">{form.timezone.replace('_', ' ')}</div>
          )}
        </div>

        {/* Submit / Cancel Action Sections */}
        {isEditing && (
          <div className="pt-2 flex items-center gap-3">
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

        {exists && !isEditing && (
          <div className="pt-4 border-t border-neutral-800 mt-6">
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