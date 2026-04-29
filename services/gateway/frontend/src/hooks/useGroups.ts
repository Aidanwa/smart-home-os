import { useState, useEffect, useCallback } from 'react';

export interface GroupMember {
  ieee_address: string;
  endpoint: number;
  name: string; // This matches the device friendly_name
}

export interface GroupInfo {
  id: number;
  friendly_name: string;
  members: GroupMember[];
}

export function useGroups() {
  const [groups, setGroups] = useState<GroupInfo[]>([]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/groups', { headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' } });
      const data = await res.json();
      setGroups(data || []);
    } catch (e) {
      console.error("Failed to fetch groups", e);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const createGroup = async (friendly_name: string) => {
    await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' },
      body: JSON.stringify({ friendly_name })
    });
    // Wait a moment for Z2M to broadcast the new bridge state, then refresh
    setTimeout(fetchGroups, 1000); 
  };

  const deleteGroup = async (group_name: string) => {
    await fetch(`/api/groups/${group_name}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' }
    });
    setTimeout(fetchGroups, 1000);
  };

  const addDeviceToGroup = async (group_name: string, device: string) => {
    await fetch(`/api/groups/${group_name}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' },
      body: JSON.stringify({ device })
    });
    setTimeout(fetchGroups, 1000);
  };

  const removeDeviceFromGroup = async (group_name: string, device: string) => {
    await fetch(`/api/groups/${group_name}/members/${device}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' }
    });
    setTimeout(fetchGroups, 1000);
  };

  const sendGroupCommand = async (group_name: string, payload: any) => {
    await fetch(`/api/groups/${group_name}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' },
      body: JSON.stringify(payload)
    });
  };

  return { groups, fetchGroups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand };
}