export type PlaylistTotals = {
  total?: number;
  remaining?: number;
};

export const calculatePlaylistTotals = (
  durations: Array<number | undefined>,
  playedMs: number,
): PlaylistTotals => {
  if (!durations.length) return { total: undefined, remaining: undefined };
  const allKnown = durations.every((value) => value !== undefined);
  if (!allKnown) return { total: undefined, remaining: undefined };
  const total = durations.reduce((sum, value) => sum + (value ?? 0), 0);
  const remaining = Math.max(0, total - Math.max(0, playedMs));
  return { total, remaining };
};
