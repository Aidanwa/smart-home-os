import { useAuth } from '../context/AuthContext';
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
  const { authenticatedFetch } = useAuth();
  const [groups, setGroups] = useState<GroupInfo[]>([]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/groups');
      const data = await res.json();
      setGroups(data || []);
    } catch (e) {
      console.error("Failed to fetch groups", e);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Listen for real-time WebSocket updates from useDevices ---
  useEffect(() => {
    const handleGroupsSync = (event: CustomEvent) => {
      // event.detail contains the data.groups payload we sent from useDevices
      console.log("🎯 GROUP HOOK RECEIVED CUSTOM EVENT:", event.detail);
      setGroups(event.detail);
    };

    window.addEventListener('onGroupsUpdate', handleGroupsSync as EventListener);
    
    // Cleanup the listener when the component unmounts
    return () => {
      window.removeEventListener('onGroupsUpdate', handleGroupsSync as EventListener);
    };
  }, []);

  const createGroup = async (friendly_name: string) => {
    await authenticatedFetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendly_name })
    });
    // Wait a moment for Z2M to broadcast the new bridge state, then refresh
    setTimeout(fetchGroups, 1000); 
  };

  const deleteGroup = async (group_name: string) => {
    await authenticatedFetch(`/api/groups/${group_name}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    setTimeout(fetchGroups, 1000);
  };

  const addDeviceToGroup = async (group_name: string, device: string) => {
    await authenticatedFetch(`/api/groups/${group_name}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device })
    });
    setTimeout(fetchGroups, 1000);
  };

  const removeDeviceFromGroup = async (group_name: string, device: string) => {
    await authenticatedFetch(`/api/groups/${group_name}/members/${device}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    setTimeout(fetchGroups, 1000);
  };

  const sendGroupCommand = async (group_name: string, payload: any) => {
    await authenticatedFetch(`/api/groups/${group_name}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  };
  
  const renameGroup = async (old_name: string, new_name: string) => {
    await authenticatedFetch(`/api/groups/${old_name}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name })
    });
    setTimeout(fetchGroups, 1000);
  };

  return { groups, fetchGroups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand, renameGroup };
}