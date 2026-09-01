/**
 * Device shape, for presentation only. Nothing here may influence gameplay or
 * lockstep — two peers on different devices must still simulate identically.
 */

function media(query: string): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
}

/** The primary pointer cannot hit small targets: a finger rather than a mouse. */
export function isCoarsePointer(): boolean {
  return media('(pointer: coarse)');
}

/** Touch is available, whether or not it is the primary input. */
export function isTouchCapable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

/** Coarse pointer and no mouse: the case that needs bigger type and targets. */
export function prefersTouchLayout(): boolean {
  return isCoarsePointer() && !media('(any-pointer: fine)');
}

export function isPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth;
}

export function canFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const target = document.documentElement as FullscreenTarget;
  return !!(target.requestFullscreen || target.webkitRequestFullscreen);
}

interface FullscreenTarget extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/** Fullscreen is what buys back the browser chrome on a phone. */
export async function requestFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || document.fullscreenElement) return;
  const target = document.documentElement as FullscreenTarget;
  try {
    if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
    else await target.webkitRequestFullscreen?.();
  } catch {
    // Fullscreen is a nicety; a refusal must never interrupt play.
  }
}

interface LockableOrientation extends ScreenOrientation {
  lock?: (orientation: string) => Promise<void>;
}

/** Landscape lock where the browser allows it; Safari ignores this. */
export async function lockLandscape(): Promise<void> {
  if (typeof screen === 'undefined') return;
  try {
    await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
  } catch {
    // Not supported everywhere, so the rotate prompt remains the fallback.
  }
}
