// src/components/rooms/hooks/useRoomLayout.ts

import { useCallback, useEffect, useState } from 'react';
import type { LogicalZone, DevicePlacement } from '../types';

interface HomeConfig {
  bottom_floor: number;
  top_floor: number;
}

export function useRoomLayout() {
  const [homeConfig, setHomeConfig] = useState<HomeConfig | null>(null);
  const [checkingHome, setCheckingHome] = useState(true);
  const [currentFloor, setCurrentFloor] = useState(1);
  const [placements, setPlacements] = useState<DevicePlacement[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          setHomeConfig({
            bottom_floor: data.bottom_floor ?? 1,
            top_floor: data.top_floor ?? 1,
          });
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
      .catch((err) => {
        console.error("Failed to fetch placements:", err);
        setError("Failed to load device placements.");
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

    try {
      const promises: Promise<any>[] = [];

      // Queue Zone Layout Updates
      if (zones.length > 0) {
        promises.push(
          ...zones.map((zone) =>
            fetch(`/api/zones/${zone.id}/layout`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                width: zone.width,
                height: zone.height,
                pos_x: zone.pos_x,
                pos_y: zone.pos_y,
              }),
            })
          )
        );
      }

      // Queue Device Placement Batch Update
      if (placements.length > 0) {
        promises.push(
          fetch('/api/zones/placements/batch', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placements }),
          })
        );
      }

      await Promise.all(promises);
      setIsDirty(false);
    } catch (err) {
      console.error("Failed to save layout and placements:", err);
      setError("Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
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

  const deleteRoom = useCallback(async (zoneId: string) => {
    await fetch(`/api/zones/${zoneId}`, {
      method: 'DELETE',
    });

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

      await fetch(`/api/zones/${zoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
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
    error,

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