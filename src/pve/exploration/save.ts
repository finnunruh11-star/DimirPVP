// Autosave for an Exploration run. Everything read back off disk is treated as
// hostile: the party goes through `parseScenario`, and every scalar is clamped
// or dropped rather than trusted.

import { parseScenario } from '../../core/Scenario';
import { createWorld } from './world';
import { EXPLORATION_VERSION, type ExplorationRun } from './run';

const STORAGE_KEY = 'dimir.exploration.v1';
const MAX_FLAGS = 256;
const MAX_VISITED = 2048;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveRun(run: ExplorationRun): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearRun(): void {
  storage()?.removeItem(STORAGE_KEY);
}

export function hasSavedRun(): boolean {
  return !!storage()?.getItem(STORAGE_KEY);
}

const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

const strings = (value: unknown, cap: number): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, cap)
    : [];

/** Read the stored run, or null when there is none and when it cannot be trusted. */
export function loadRun(): ExplorationRun | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (int(parsed.version, 0) !== EXPLORATION_VERSION) return null;

    const world = createWorld();
    const nodeId = typeof parsed.nodeId === 'string' && world.has(parsed.nodeId) ? parsed.nodeId : null;
    if (!nodeId) return null;

    // parseScenario does the heavy validation of the roster itself.
    const party = parseScenario(JSON.stringify(parsed.party));

    return {
      version: EXPLORATION_VERSION,
      seed: int(parsed.seed, 1) >>> 0,
      steps: Math.max(0, int(parsed.steps, 0)),
      nodeId,
      gold: Math.max(0, int(parsed.gold, 0)),
      party,
      flags: strings(parsed.flags, MAX_FLAGS),
      visited: strings(parsed.visited, MAX_VISITED).filter((id) => world.has(id)),
    };
  } catch {
    return null;
  }
}
