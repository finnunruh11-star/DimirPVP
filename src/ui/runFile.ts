// =============================================================================
//  RUN FILES
// -----------------------------------------------------------------------------
//  An Adventure run saved to (and read back from) a file on this device, so a
//  run survives a cleared browser or a relay address that changed. A file is
//  as untrusted as any save: it goes through parseRun.
// =============================================================================

import type { ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';

const MAX_FILE_BYTES = 8_000_000;
const FORMAT = 'dimir-adventure';

/** Which save a file belongs in: the solo run, or the co-op run a host keeps. */
export type RunFileSlot = 'solo' | 'online';

export interface RunFile {
  run: ExplorationRun;
  slot: RunFileSlot;
}

/** Push the run to the browser as a .json download. */
export function downloadRun(run: ExplorationRun, slot: RunFileSlot): void {
  const body = JSON.stringify({ format: FORMAT, slot, saved: new Date().toISOString(), run });
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  link.href = url;
  link.download = `dimir-${slot === 'online' ? 'coop' : 'solo'}-day${run.day}-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the click has definitely started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a run file's text; null when it holds no run this game can trust. */
export function readRunFile(text: string): RunFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const file = parsed as Record<string, unknown>;
  const wrapped = file.format === FORMAT;
  // A bare autosave copied out of the browser loads too.
  const run = parseRun(JSON.stringify(wrapped ? file.run : file));
  if (!run) return null;
  const slot: RunFileSlot = wrapped && (file.slot === 'solo' || file.slot === 'online')
    ? file.slot
    : run.party.entities.length > 1 ? 'online' : 'solo';
  return { run, slot };
}

/**
 * Open the OS file picker and read one run back. Resolves null when the user
 * cancels; rejects when the picked file is unreadable or holds no run.
 */
export function pickRunFile(): Promise<RunFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      input.remove();
      run();
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(() => resolve(null));
      if (file.size > MAX_FILE_BYTES) return finish(() => reject(new Error('That file is too large to be a saved run.')));
      const reader = new FileReader();
      reader.onerror = () => finish(() => reject(new Error('Could not read that file.')));
      reader.onload = () => {
        finish(() => {
          const loaded = readRunFile(String(reader.result ?? ''));
          if (loaded) resolve(loaded);
          else reject(new Error('That file holds no run this version of the game can load.'));
        });
      };
      reader.readAsText(file);
    });
    // Fires when the picker is dismissed without choosing anything.
    input.addEventListener('cancel', () => finish(() => resolve(null)));
    document.body.appendChild(input);
    input.click();
  });
}
