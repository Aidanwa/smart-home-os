import { useAuth } from '../context/AuthContext';
import { useState, useEffect, useCallback } from 'react';
import { request } from '../lib/api';

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
      setGroups(event.detail);
    };

    window.addEventListener('onGroupsUpdate', handleGroupsSync as EventListener);
    // Group changes broadcast while the socket was down were missed: refetch.
    window.addEventListener('onRealtimeReconnect', fetchGroups);

    // Cleanup the listener when the component unmounts
    return () => {
      window.removeEventListener('onGroupsUpdate', handleGroupsSync as EventListener);
      window.removeEventListener('onRealtimeReconnect', fetchGroups);
    };
  }, [fetchGroups]);

  // Z2M publishes the new group list shortly after it answers, so refresh a moment later.
  // Callers await this, which keeps their "busy" state until the list has caught up.
  const refreshSoon = async () => {
    await new Promise(r => setTimeout(r, 1000));
    await fetchGroups();
  };

  const call = async (what: string, url: string, init: RequestInit, refresh = true) => {
    const ok = await request(what, () => authenticatedFetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    }));
    if (ok && refresh) await refreshSoon();
    return ok;
  };

  const enc = encodeURIComponent;

  const createGroup = (friendly_name: string) =>
    call(`create the group ${friendly_name}`, '/api/groups', { method: 'POST', body: JSON.stringify({ friendly_name }) });

  const deleteGroup = (group_name: string) =>
    call(`delete ${group_name}`, `/api/groups/${enc(group_name)}`, { method: 'DELETE' });

  const addDeviceToGroup = (group_name: string, device: string, label = device) =>
    call(`add ${label} to ${group_name}`, `/api/groups/${enc(group_name)}/members`, { method: 'POST', body: JSON.stringify({ device }) });

  const removeDeviceFromGroup = (group_name: string, device: string, label = device) =>
    call(`remove ${label} from ${group_name}`, `/api/groups/${enc(group_name)}/members/${enc(device)}`, { method: 'DELETE' });

  const sendGroupCommand = (group_name: string, payload: Record<string, unknown>, what = `change ${group_name}`) =>
    call(what, `/api/groups/${enc(group_name)}/set`, { method: 'POST', body: JSON.stringify(payload) }, false);

  const renameGroup = (old_name: string, new_name: string) =>
    call(`rename ${old_name}`, `/api/groups/${enc(old_name)}/rename`, { method: 'PUT', body: JSON.stringify({ new_name }) });

  return { groups, fetchGroups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand, renameGroup };
}