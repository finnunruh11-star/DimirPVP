import { prefersTouchLayout } from '../../config/device';

/**
 * Canvas type is authored for a 1280x720 desktop window. On a phone that same
 * canvas is letterboxed into a few physical inches, so small labels have to be
 * lifted or they resolve to a handful of pixels.
 *
 * Only the multiplier and the floor live here; call sites keep their authored
 * sizes so the desktop layout is unchanged.
 */
const TOUCH_SCALE = 1.25;
const TOUCH_FLOOR = 13;

let cached: number | null = null;

export function textScale(): number {
  if (cached === null) cached = prefersTouchLayout() ? TOUCH_SCALE : 1;
  return cached;
}

/** A font size string for `scene.add.text`, lifted on touch devices. */
export function px(size: number): string {
  const scale = textScale();
  if (scale === 1) return `${size}px`;
  return `${Math.max(Math.round(size * scale), TOUCH_FLOOR)}px`;
}

/** Scale a layout length that has to grow with the text it holds. */
export function scaled(length: number): number {
  return Math.round(length * textScale());
}
