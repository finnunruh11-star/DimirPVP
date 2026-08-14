import Phaser from 'phaser';
import { COLORS } from '../config/constants';
import type { MatchConfig } from '../config/MatchConfig';
import type { Scenario } from '../core/Scenario';
import { MenuExperience } from '../ui/menu/MenuExperience';
import { MenuModel } from '../ui/menu/MenuModel';
import { preloadMenuArt } from '../ui/menu/art';

/** Lifecycle host for the connected pre-match cabinet interface. */
export class MenuScene extends Phaser.Scene {
  private model = new MenuModel();
  private experience?: MenuExperience;

  constructor() {
    super('Menu');
  }

  preload(): void {
    preloadMenuArt(this);
  }

  create(): void {
    this.destroyExperience();
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.model = new MenuModel();
    this.experience = new MenuExperience(
      this,
      this.model,
      () => this.launchLocal(),
      (scenario) => this.launchMemory(scenario),
      (config) => this.launch(config)
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyExperience, this);
  }

  private launchLocal(): void {
    try {
      this.launch(this.model.toLocalMatchConfig());
    } catch (error) {
      this.experience?.setStatus(
        error instanceof Error ? error.message : 'The match setup is incomplete.'
      );
    }
  }

  private launchMemory(scenario: Scenario): void {
    this.launch(this.model.toMemoryMatchConfig(scenario));
  }

  private launch(config: MatchConfig): void {
    this.destroyExperience();
    this.scene.start('Game', config);
  }

  private destroyExperience(): void {
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroyExperience, this);
    this.experience?.destroy();
    this.experience = undefined;
  }
}