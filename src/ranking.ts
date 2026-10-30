export interface RankEntry {
  id: string;
  served: number;
  delivered: number;
  createdAt: number;
}

export type RankingStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const RANKING_KEY = 'sushi-loop-ranking-v1';
const caches = new WeakMap<RankingStorage, { entries: RankEntry[]; dirty: boolean }>();
let memory: RankEntry[] = [];

function valid(value: unknown): value is RankEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as RankEntry;
  return typeof entry.id === 'string' && entry.id.trim().length > 0 && entry.id.length <= 200
    && [entry.served, entry.delivered, entry.createdAt].every(n => Number.isSafeInteger(n) && n >= 0);
}

/** Keep ten runs, with earlier runs winning otherwise equal results. */
export function topRanking(entries: readonly unknown[]): RankEntry[] {
  const unique = new Map<string, RankEntry>();
  for (const value of entries) {
    if (valid(value)) unique.set(value.id, { id: value.id, served: value.served, delivered: value.delivered, createdAt: value.createdAt });
  }
  return [...unique.values()].sort((a, b) => b.served - a.served || b.delivered - a.delivered || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 10);
}

function resolveStorage(override?: RankingStorage | null): RankingStorage | null {
  if (override !== undefined) return override;
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

export function readRanking(override?: RankingStorage | null): RankEntry[] {
  const storage = resolveStorage(override);
  if (!storage) return topRanking(memory);
  const cache = caches.get(storage);
  try {
    const raw = storage.getItem(RANKING_KEY);
    let parsed: unknown = [];
    try { parsed = raw === null ? [] : JSON.parse(raw); } catch { /* Ignore damaged data. */ }
    const stored = topRanking(Array.isArray(parsed) ? parsed : []);
    const entries = cache?.dirty ? topRanking([...stored, ...cache.entries]) : stored;
    caches.set(storage, { entries, dirty: cache?.dirty ?? false });
    return topRanking(entries);
  } catch {
    return topRanking(cache?.entries ?? memory);
  }
}

/** Updating the same run replaces its previous result instead of adding a row. */
export function recordResult(entry: RankEntry, override?: RankingStorage | null): RankEntry[] {
  const storage = resolveStorage(override);
  const previous = readRanking(storage);
  if (!valid(entry)) return previous;
  const entries = topRanking([...previous, entry]);
  memory = entries;
  if (storage) {
    let dirty = true;
    try { storage.setItem(RANKING_KEY, JSON.stringify(entries)); dirty = false; } catch { /* Keep this session's results available. */ }
    caches.set(storage, { entries, dirty });
  }
  return topRanking(entries);
}
