const STORAGE_KEY = 'dimir-motion';

export type MotionPreference = 'system' | 'full' | 'reduced';

export function motionPreference(): MotionPreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'full' || stored === 'reduced') return stored;
  } catch {
    // Storage may be blocked; the OS preference remains a safe fallback.
  }
  return 'system';
}

export function isReducedMotion(): boolean {
  const preference = motionPreference();
  if (preference === 'reduced') return true;
  if (preference === 'full') return false;
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function setMotionPreference(preference: MotionPreference): void {
  if (typeof window === 'undefined') return;
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A blocked preference store should never block gameplay.
  }
}

export function toggleMotionPreference(): MotionPreference {
  const next: MotionPreference = isReducedMotion() ? 'full' : 'reduced';
  setMotionPreference(next);
  return next;
}
