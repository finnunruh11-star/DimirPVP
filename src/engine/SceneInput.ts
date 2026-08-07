import Phaser from 'phaser';

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
