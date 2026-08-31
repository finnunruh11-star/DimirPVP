import {
  canFullscreen,
  isPortrait,
  isTouchCapable,
  lockLandscape,
  requestFullscreen,
} from '../config/device';

/**
 * Touch-only browser chrome: nag for landscape and take fullscreen on the
 * first gesture. Lives outside Phaser because it has to work before the game
 * boots and while the canvas is the wrong shape to render a prompt into.
 */
export function installMobileShell(): void {
  if (typeof document === 'undefined' || !isTouchCapable()) return;

  const rotate = document.getElementById('rotate');
  const sync = (): void => {
    rotate?.setAttribute('data-show', isPortrait() ? '1' : '0');
  };
  sync();
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });

  if (!canFullscreen()) return;
  // Browsers only grant fullscreen from a real gesture, so ask on the first one.
  const claim = (): void => {
    window.removeEventListener('pointerdown', claim, true);
    void requestFullscreen().then(lockLandscape);
  };
  window.addEventListener('pointerdown', claim, true);
}
