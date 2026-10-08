/** Query history: append-only log with favorites, search, and a 200-entry cap.
 *  Persisted to localStorage by the store subscriber (see App).
 */

export interface HistoryEntry {
  id: string;
  sql: string;
  connection: string;
  elapsedMs: number;
  ok: boolean;
  at: number;
  favorite: boolean;
}

export const HISTORY_LIMIT = 200;
export const HISTORY_KEY = "luminosql.history";

export function record(
  entries: HistoryEntry[],
  draft: { sql: string; connection: string; elapsedMs: number; ok: boolean },
): HistoryEntry[] {
  const entry: HistoryEntry = { ...draft, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), favorite: false };
  return [entry, ...entries].slice(0, HISTORY_LIMIT);
}

export function toggleFavorite(entries: HistoryEntry[], id: string): HistoryEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e));
}

export function search(entries: HistoryEntry[], q: string): HistoryEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(
    (e) => e.sql.toLowerCase().includes(needle) || e.connection.toLowerCase().includes(needle),
  );
}

export function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function save(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    /* private mode */
  }
}

export function groupLabel(at: number): string {
  const day = new Date(at).toDateString();
  if (day === new Date().toDateString()) return "Today";
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (day === yesterday) return "Yesterday";
  return day;
}
