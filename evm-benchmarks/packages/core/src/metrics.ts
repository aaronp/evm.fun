/** nearest-rank percentile of an ascending-sorted array */
export function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedMs.length);
  return sortedMs[Math.min(sortedMs.length, Math.max(1, rank)) - 1]!;
}
