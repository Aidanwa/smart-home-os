import { useEffect, useState } from 'react';

export interface RoomRef {
  id: string;
  name: string;
  floor: number;
}

export interface RoomIndex {
  /** Rooms in plan order: by floor, then name. */
  rooms: RoomRef[];
  /** IEEE address → room id, for devices placed on the floor plan. */
  roomOf: Record<string, string>;
}

/** Which room each device is in, from the Rooms tab's floor plan. Only loads while `enabled`. */
export function useRoomIndex(enabled: boolean): RoomIndex | null {
  const [index, setIndex] = useState<RoomIndex | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const json = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

    (async () => {
      const home = await json('/api/home');
      const bottom = home?.bottom_floor ?? 1;
      const top = home?.top_floor ?? 1;
      const floors = Array.from({ length: Math.max(1, top - bottom + 1) }, (_, i) => bottom + i);
      const [placements, ...perFloor] = await Promise.all([
        json('/api/zones/placements'),
        ...floors.map(f => json(`/api/zones?floor_level=${f}`)),
      ]);
      if (cancelled) return;
      const rooms: RoomRef[] = perFloor
        .flatMap((zs, i) => (Array.isArray(zs) ? zs : []).map((z: { id: string; name: string }) => ({ id: z.id, name: z.name, floor: floors[i] })))
        .sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
      const known = new Set(rooms.map(r => r.id));
      const roomOf: Record<string, string> = {};
      for (const p of Array.isArray(placements) ? placements : []) {
        if (p.zone_id && known.has(p.zone_id)) roomOf[p.ieee_address] = p.zone_id;
      }
      setIndex({ rooms, roomOf });
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  return index;
}
