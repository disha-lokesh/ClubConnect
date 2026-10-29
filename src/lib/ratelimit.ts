// Minimal in-memory login throttle (per process). Good enough for a single-node demo; use Redis or a DB table in production.
const hits = new Map<string, number[]>();
export function tooManyAttempts(key: string, max = 6, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now(); const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  hits.set(key, recent); return recent.length >= max;
}
export function recordAttempt(key: string) { hits.set(key, [...(hits.get(key) ?? []), Date.now()]); }
export function clearAttempts(key: string) { hits.delete(key); }
