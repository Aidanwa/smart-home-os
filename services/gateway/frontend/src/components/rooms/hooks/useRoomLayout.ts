// src/components/rooms/hooks/useRoomLayout.ts

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { LogicalZone, DevicePlacement } from '../types';
import { request } from '../../../lib/api';

interface HomeConfig {
  bottom_floor: number;
  top_floor: number;
}

export function useRoomLayout() {
  const [homeConfig, setHomeConfig] = useState<HomeConfig | null>(null);
  const [checkingHome, setCheckingHome] = useState(true);
  // The floor last looked at, remembered on this device (most control happens on one floor).
  const [currentFloor, setFloorState] = useState(() => {
    try { const n = Number(localStorage.getItem('rooms.floor')); return Number.isInteger(n) && localStorage.getItem('rooms.floor') !== null ? n : 1; } catch { return 1; }
  });
  const setCurrentFloor = useCallback((floor: number) => {
    setFloorState(floor);
    try { localStorage.setItem('rooms.floor', String(floor)); } catch { /* private mode */ }
  }, []);
  const [placements, setPlacements] = useState<DevicePlacement[]>([]);

  const [zones, setZones] = useState<LogicalZone[]>([]);
  const [baseFloorZones, setBaseFloorZones] = useState<LogicalZone[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ==========================================
  // 1. DATA FETCHING
  // ==========================================

  // Fetch Home Config
  useEffect(() => {
    fetch('/api/home')
      .then((res) => res.json())
      .then((data) => {
        if (data?.id) {
          const config = { bottom_floor: data.bottom_floor ?? 1, top_floor: data.top_floor ?? 1 };
          setHomeConfig(config);
          // A remembered floor the home no longer has falls back into range.
          setFloorState(f => Math.min(config.top_floor, Math.max(config.bottom_floor, f)));
        }
      })
      .catch(console.error)
      .finally(() => setCheckingHome(false));
  }, []);

  // Fetch Active Floor Rooms
  useEffect(() => {
    if (!homeConfig) return;

    setIsLoading(true);

    fetch(`/api/zones?floor_level=${currentFloor}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setZones(Array.isArray(data) ? data : []))
      .catch(() => setZones([]))
      .finally(() => setIsLoading(false));
  }, [currentFloor, homeConfig]);

  // Fetch Ground Floor Ghost Layout
  useEffect(() => {
    if (!homeConfig || currentFloor === 1) {
      setBaseFloorZones([]);
      return;
    }

    fetch('/api/zones?floor_level=1')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setBaseFloorZones(Array.isArray(data) ? data : []))
      .catch(() => setBaseFloorZones([]));
  }, [currentFloor, homeConfig]);

  // Fetch Device Placements (Global)
  useEffect(() => {
    fetch('/api/zones/placements')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPlacements(Array.isArray(data) ? data : []))
      .catch(() => {
        toast.error('Couldn’t load where devices are placed', { description: 'Can’t reach the hub. Reload to try again.' });
      });
  }, []);

  // ==========================================
  // 2. CANVAS INTERACTION CALLBACKS
  // ==========================================

  // Room movement
  const handleDragEnd = useCallback(
    (zoneId: string, xFt: number, yFt: number) => {
      setZones((prev) =>
        prev.map((z) =>
          z.id === zoneId ? { ...z, pos_x: xFt, pos_y: yFt } : z
        )
      );
      setIsDirty(true);
    },
    []
  );

  // Room resize
  const handleTransformEnd = useCallback(
    (zoneId: string, xFt: number, yFt: number, widthFt: number, heightFt: number) => {
      setZones((prev) =>
        prev.map((z) =>
          z.id === zoneId
            ? { ...z, pos_x: xFt, pos_y: yFt, width: widthFt, height: heightFt }
            : z
        )
      );
      setIsDirty(true);
    },
    []
  );

  // Device Placement Movement/Assignment
  const updateDevicePlacement = useCallback(
    (ieee_address: string, zone_id: string | null, pos_x: number, pos_y: number) => {
      setPlacements((prev) => {
        const exists = prev.find((p) => p.ieee_address === ieee_address);
        if (exists) {
          // Update existing placement
          return prev.map((p) =>
            p.ieee_address === ieee_address ? { ...p, zone_id, pos_x, pos_y } : p
          );
        }
        // Create new placement record in memory
        return [...prev, { ieee_address, zone_id, pos_x, pos_y, pos_z: 0 }];
      });
      
      setIsDirty(true);
    },
    []
  );

  // ==========================================
  // 3. PERSISTENCE & AUTOSAVE
  // ==========================================

  const saveAll = useCallback(async () => {
    if (!zones.length && !placements.length) return;

    setIsSaving(true);
    const requests: Promise<boolean>[] = zones.map((zone) =>
      request(`save ${zone.name}`, () => fetch(`/api/zones/${zone.id}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: zone.width, height: zone.height, pos_x: zone.pos_x, pos_y: zone.pos_y }),
      })));
    if (placements.length > 0) {
      requests.push(request('save where devices are placed', () => fetch('/api/zones/placements/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placements }),
      })));
    }
    const results = await Promise.all(requests);
    // Anything that failed has said so in a toast; stay dirty so "Save now" and the autosave retry.
    if (results.every(Boolean)) setIsDirty(false);
    setIsSaving(false);
  }, [zones, placements]);

  // Autosave Timer
  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      saveAll();
    }, 5000);

    return () => clearTimeout(timer);
  }, [isDirty, saveAll]);

  // ==========================================
  // 4. CRUD OPERATIONS (ROOMS)
  // ==========================================

  const createRoom = useCallback(
    async (name: string, widthFt: number, heightFt: number, color: string) => {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          floor_level: currentFloor,
          width: widthFt,
          height: heightFt,
          pos_x: 2,
          pos_y: 2,
          color,
        }),
      });

      if (!res.ok) {
        throw new Error((await res.json()).detail ?? 'Creation failed');
      }

      const zone = await res.json();
      setZones((prev) => [...prev, zone]);
      return zone;
    },
    [currentFloor]
  );

  const deleteRoom = useCallback(async (zoneId: string, name: string) => {
    const ok = await request(`delete ${name}`, () => fetch(`/api/zones/${zoneId}`, { method: 'DELETE' }));
    if (!ok) throw new Error('not deleted');

    // Remove zone from UI
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    
    // Clean up placements assigned to this deleted room instantly on the UI
    setPlacements((prev) => 
      prev.map((p) => p.zone_id === zoneId ? { ...p, zone_id: null } : p)
    );
  }, []);

  const updateRoom = useCallback(
    async (zoneId: string, updates: { name?: string; color?: string; }) => {
      setZones((prev) =>
        prev.map((z) => (z.id === zoneId ? { ...z, ...updates } : z))
      );

      await request('rename the room', () => fetch(`/api/zones/${zoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }));
    },
    []
  );

  return {
    homeConfig,
    checkingHome,
    
    zones,
    baseFloorZones,
    placements,
    
    isLoading,
    isDirty,
    isSaving,

    currentFloor,
    setCurrentFloor,

    createRoom,
    deleteRoom,
    updateRoom,
    saveAll,

    handleDragEnd,
    handleTransformEnd,
    updateDevicePlacement,
  };
}