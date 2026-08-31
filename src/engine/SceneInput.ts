import Phaser from 'phaser';
import { unlockAudio } from '../audio';

export interface KeyBinding {
  key: string;
  run: (event: KeyboardEvent) => void;
  capture?: boolean;
  allowRepeat?: boolean;
}

type Cleanup = () => void;

/**
 * Scene-owned input subscriptions. Every listener and browser capture is
 * released when its scene shuts down, so returning to a scene cannot stack
 * duplicate controls.
 */
export class SceneInput {
  private readonly cleanups: Cleanup[] = [];
  private readonly captures = new Set<string>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  bindKeys(bindings: readonly KeyBinding[]): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;

    for (const binding of bindings) {
      const eventName = `keydown-${binding.key}`;
      const handler = (event: KeyboardEvent): void => {
        if (!binding.allowRepeat && event.repeat) return;
        unlockAudio();
        binding.run(event);
      };
      keyboard.on(eventName, handler);
      this.cleanups.push(() => keyboard.off(eventName, handler));
      if (binding.capture) {
        keyboard.addCapture(binding.key);
        this.captures.add(binding.key);
      }
    }
  }

  bindAnyKey(run: (event: KeyboardEvent) => void, allowRepeat = false): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;
    const handler = (event: KeyboardEvent): void => {
      if (!allowRepeat && event.repeat) return;
      unlockAudio();
      run(event);
    };
    keyboard.on('keydown', handler);
    this.cleanups.push(() => keyboard.off('keydown', handler));
  }

  bindPointerMove(run: (pointer: Phaser.Input.Pointer) => void): void {
    this.scene.input.on('pointermove', run);
    this.cleanups.push(() => this.scene.input.off('pointermove', run));
  }

  bindPointerDown(run: (pointer: Phaser.Input.Pointer) => void): void {
    this.scene.input.on('pointerdown', run);
    this.cleanups.push(() => this.scene.input.off('pointerdown', run));
  }

  /**
   * Field pointer with a touch-aware press. A mouse acts on press, as always.
   * Touch defers to release, because the long press that stands in for a
   * right-click has to be able to cancel the tap it started as.
   */
  bindPointerPress(options: {
    press: (pointer: Phaser.Input.Pointer) => void;
    /** Return true if the press was handled, which cancels the pending tap. */
    longPress?: (pointer: Phaser.Input.Pointer) => boolean;
    holdMs?: number;
    slopPx?: number;
  }): void {
    const holdMs = options.holdMs ?? 420;
    const slopPx = options.slopPx ?? 16;
    let timer: Phaser.Time.TimerEvent | null = null;
    let origin: { x: number; y: number } | null = null;
    let consumed = false;

    const clearTimer = (): void => {
      timer?.remove();
      timer = null;
    };
    const down = (pointer: Phaser.Input.Pointer): void => {
      if (!pointer.wasTouch) {
        options.press(pointer);
        return;
      }
      clearTimer();
      consumed = false;
      origin = { x: pointer.x, y: pointer.y };
      if (!options.longPress) return;
      timer = this.scene.time.delayedCall(holdMs, () => {
        timer = null;
        unlockAudio();
        consumed = options.longPress?.(pointer) === true;
      });
    };
    const move = (pointer: Phaser.Input.Pointer): void => {
      if (!origin || !timer) return;
      if (Phaser.Math.Distance.Between(origin.x, origin.y, pointer.x, pointer.y) > slopPx) {
        clearTimer();
      }
    };
    const up = (pointer: Phaser.Input.Pointer): void => {
      if (!pointer.wasTouch) return;
      clearTimer();
      origin = null;
      if (consumed) {
        consumed = false;
        return;
      }
      unlockAudio();
      options.press(pointer);
    };
    const abort = (): void => {
      clearTimer();
      origin = null;
      consumed = false;
    };

    this.scene.input.on('pointerdown', down);
    this.scene.input.on('pointermove', move);
    this.scene.input.on('pointerup', up);
    this.scene.input.on('pointerupoutside', abort);
    this.cleanups.push(() => {
      abort();
      this.scene.input.off('pointerdown', down);
      this.scene.input.off('pointermove', move);
      this.scene.input.off('pointerup', up);
      this.scene.input.off('pointerupoutside', abort);
    });
  }

  disableContextMenu(): void {
    this.scene.input.mouse?.disableContextMenu();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (let i = this.cleanups.length - 1; i >= 0; i--) this.cleanups[i]();
    this.cleanups.length = 0;

    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      for (const key of this.captures) keyboard.removeCapture(key);
    }
    this.captures.clear();
  }
}
