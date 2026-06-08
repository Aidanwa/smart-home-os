// src/components/rooms/hooks/useRoomLayout.ts

import { useCallback, useEffect, useState } from 'react';

import type { LogicalZone } from '../types';

interface HomeConfig {
  bottom_floor: number;
  top_floor: number;
}

export function useRoomLayout() {
  const [homeConfig, setHomeConfig] = useState<HomeConfig | null>(null);
  const [checkingHome, setCheckingHome] = useState(true);
  const [currentFloor, setCurrentFloor] = useState(1);

  const [zones, setZones] = useState<LogicalZone[]>([]);
  const [baseFloorZones, setBaseFloorZones] = useState<LogicalZone[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  //
  // Home config
  //
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

  //
  // Active floor rooms
  //
  useEffect(() => {
    if (!homeConfig) return;

    setIsLoading(true);

    fetch(`/api/zones?floor_level=${currentFloor}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setZones(Array.isArray(data) ? data : []))
      .catch(() => setZones([]))
      .finally(() => setIsLoading(false));
  }, [currentFloor, homeConfig]);

  //
  // Ground floor ghost layout
  //
  useEffect(() => {
    if (!homeConfig || currentFloor === 1) {
      setBaseFloorZones([]);
      return;
    }

    fetch('/api/zones?floor_level=1')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) =>
        setBaseFloorZones(Array.isArray(data) ? data : [])
      )
      .catch(() => setBaseFloorZones([]));
  }, [currentFloor, homeConfig]);

  //
  // Room movement
  //
  const handleDragEnd = useCallback(
    (zoneId: string, xFt: number, yFt: number) => {
      setZones((prev) =>
        prev.map((z) =>
          z.id === zoneId
            ? {
                ...z,
                pos_x: xFt,
                pos_y: yFt,
              }
            : z
        )
      );

      setIsDirty(true);
    },
    []
  );

  //
  // Room resize
  //
  const handleTransformEnd = useCallback(
    (
      zoneId: string,
      xFt: number,
      yFt: number,
      widthFt: number,
      heightFt: number
    ) => {
      setZones((prev) =>
        prev.map((z) =>
          z.id === zoneId
            ? {
                ...z,
                pos_x: xFt,
                pos_y: yFt,
                width: widthFt,
                height: heightFt,
              }
            : z
        )
      );

      setIsDirty(true);
    },
    []
  );

  //
  // Save layout
  //
  const saveAll = useCallback(async () => {
    if (!zones.length) return;

    setIsSaving(true);

    try {
      await Promise.all(
        zones.map((zone) =>
          fetch(`/api/zones/${zone.id}/layout`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              width: zone.width,
              height: zone.height,
              pos_x: zone.pos_x,
              pos_y: zone.pos_y,
            }),
          })
        )
      );

      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [zones]);

  //
  // Autosave
  //
  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      saveAll();
    }, 5000);

    return () => clearTimeout(timer);
  }, [isDirty, saveAll]);

  //
  // Create room
  //
  const createRoom = useCallback(
    async (
      name: string,
      widthFt: number,
      heightFt: number,
      color: string
    ) => {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        throw new Error(
          (await res.json()).detail ?? 'Creation failed'
        );
      }

      const zone = await res.json();

      setZones((prev) => [...prev, zone]);

      return zone;
    },
    [currentFloor]
  );

  //
  // Delete room
  //
  const deleteRoom = useCallback(async (zoneId: string) => {
    await fetch(`/api/zones/${zoneId}`, {
      method: 'DELETE',
    });

    setZones((prev) =>
      prev.filter((z) => z.id !== zoneId)
    );
  }, []);

  //
  // Rename / recolor
  //
  const updateRoom = useCallback(
    async (
      zoneId: string,
      updates: {
        name?: string;
        color?: string;
      }
    ) => {
      setZones((prev) =>
        prev.map((z) =>
          z.id === zoneId
            ? {
                ...z,
                ...updates,
              }
            : z
        )
      );

      await fetch(`/api/zones/${zoneId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
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
  };
}