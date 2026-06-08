export const PX_PER_FOOT = 20;
export const GRID_FT = 0.5;
export const GRID_PX = PX_PER_FOOT * GRID_FT;

export const ROOM_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#64748b',
];

export const ftToPx = (ft: number) => ft * PX_PER_FOOT;
export const pxToFt = (px: number) =>
  Math.round((px / PX_PER_FOOT) * 10) / 10;

export const formatFloorName = (floorNum: number): string => {
  if (floorNum === 0) return 'Basement';
  if (floorNum === 1) return 'Ground Floor';
  const rules = new Intl.PluralRules('en', { type: 'ordinal' });
  const suffixes = { zero: 'th', one: 'st', two: 'nd', few: 'rd', many: 'th', other: 'th' };
  const suffix = suffixes[rules.select(floorNum)];
  return `${floorNum}${suffix} Floor`;
};