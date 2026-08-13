// =============================================================================
//  SCENARIO FILES
// -----------------------------------------------------------------------------
//  Browser download / upload for saved combat scenarios. Kept out of the scenes
//  so the game logic never touches the DOM directly.
// =============================================================================

import { captureScenario, parseScenario, type Scenario, type ScenarioSource } from '../core/Scenario';

/** Max bytes accepted from a picked file — a scenario is a few KB at most. */
const MAX_FILE_BYTES = 2_000_000;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'scenario';
}

/** Serialise the current fight and push it to the browser as a .json download. */
export function downloadScenario(gs: ScenarioSource, name: string): Scenario {
  const scenario = captureScenario(gs, name);
  const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugify(scenario.name)}.dimir.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the click has definitely started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return scenario;
}

/**
 * Open the OS file picker and read one scenario back. Resolves null when the
 * user cancels; rejects when the picked file is unreadable or malformed.
 */
export function pickScenarioFile(): Promise<Scenario | null> {
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
      if (file.size > MAX_FILE_BYTES) {
        return finish(() => reject(new Error('That file is too large to be a scenario.')));
      }
      const reader = new FileReader();
      reader.onerror = () => finish(() => reject(new Error('Could not read that file.')));
      reader.onload = () => {
        finish(() => {
          try {
            resolve(parseScenario(String(reader.result ?? '')));
          } catch (err) {
            reject(err instanceof Error ? err : new Error('That scenario could not be loaded.'));
          }
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
