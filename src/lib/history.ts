import type { SavedResult } from "./types";

const STORAGE_KEY = "stroke-analysis-history";
const MAX_ENTRIES = 50;

export function loadHistory(): SavedResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(history: SavedResult[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage full or unavailable (e.g. private browsing) — the in-memory
    // state still updates, it just won't survive a reload.
  }
}

export function saveResult(result: SavedResult): SavedResult[] {
  const next = [result, ...loadHistory()].slice(0, MAX_ENTRIES);
  persist(next);
  return next;
}

export function deleteResult(id: string): SavedResult[] {
  const next = loadHistory().filter((r) => r.id !== id);
  persist(next);
  return next;
}
