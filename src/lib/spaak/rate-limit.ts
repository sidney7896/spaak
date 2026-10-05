const WINDOW_MS = 10 * 60_000;
const MAX_LOOKUPS = 20;
const MAX_KEYS = 10_000;

// Both route bundles and development reloads share the same trial-process limit.
const shared = globalThis as typeof globalThis & { spaakLookupLimits?: Map<string, number[]> };
const limits = shared.spaakLookupLimits ??= new Map<string, number[]>();

export function checkLookup(key: string, now: number = Date.now()): boolean {
  const recent = (limits.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (recent.length >= MAX_LOOKUPS) return false;

  if (!limits.has(key) && limits.size >= MAX_KEYS) {
    const oldest = limits.keys().next().value;
    if (oldest !== undefined) limits.delete(oldest);
  }
  recent.push(now);
  limits.set(key, recent);
  return true;
}

export function resetLookupLimits(): void {
  limits.clear();
}
