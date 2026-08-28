import Phaser from 'phaser';
import type { MenuCategory } from '../../config/MatchConfig';
import type { MenuFocusGroup } from '../cabinet/controls';
import { MENU_MOTION } from '../cabinet/theme';
import { isReducedMotion } from '../cabinet/motion';

export type MenuRoute =
  | { id: 'main' }
  | { id: 'category'; category: MenuCategory }
  | { id: 'mode-intro' }
  | { id: 'raid-target'; returnToReview?: boolean }
  | { id: 'session-role' }
  | { id: 'roster'; returnToReview?: boolean }
  | { id: 'team-layout'; returnToReview?: boolean }
  | { id: 'preparation'; returnToReview?: boolean }
  | { id: 'content-packs'; returnToReview?: boolean }
  | { id: 'player-handoff'; seat: number }
  | { id: 'mage-build'; seat: number; returnToReview?: boolean }
  | { id: 'review' }
  | { id: 'memory-file' }
  | { id: 'codex' }
  | { id: 'online-lobby' };

export interface MenuScreenView {
  root: Phaser.GameObjects.Container;
  focus: MenuFocusGroup;
}

type ScreenFactory = (route: MenuRoute) => MenuScreenView;

export class MenuNavigator {
  private history: MenuRoute[] = [];
  private currentRoute: MenuRoute | null = null;
  private currentView: MenuScreenView | null = null;
  private transitioning = false;
  private readonly reducedMotion = isReducedMotion();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Container,
    private readonly buildScreen: ScreenFactory,
    private readonly onRouteChanged: (route: MenuRoute, history: readonly MenuRoute[]) => void
  ) {}

  start(route: MenuRoute): void {
    this.history = [];
    this.swap(route, 1);
  }

  push(route: MenuRoute): void {
    if (this.transitioning || !this.currentRoute) return;
    this.history.push(this.currentRoute);
    this.swap(route, 1);
  }

  back(): boolean {
    if (this.transitioning || this.history.length === 0) return false;
    const route = this.history.pop();
    if (!route) return false;
    this.swap(route, -1);
    return true;
  }

  moveFocus(direction: -1 | 1): void {
    if (!this.transitioning) this.currentView?.focus.move(direction);
  }

  adjust(direction: -1 | 1): void {
    if (this.transitioning || !this.currentView) return;
    if (!this.currentView.focus.adjust(direction)) this.currentView.focus.move(direction);
  }

  activate(): void {
    if (!this.transitioning) this.currentView?.focus.activate();
  }

  refresh(): void {
    if (this.transitioning || !this.currentRoute || !this.currentView) return;
    const outgoing = this.currentView;
    const incoming = this.buildScreen(this.currentRoute);
    this.layer.add(incoming.root);
    outgoing.root.destroy(true);
    this.currentView = incoming;
    this.onRouteChanged(this.currentRoute, this.history);
  }

  destroy(): void {
    if (this.currentView) {
      this.scene.tweens.killTweensOf(this.currentView.root);
      this.currentView.root.destroy(true);
    }
    this.currentView = null;
    this.currentRoute = null;
    this.history = [];
  }

  private swap(route: MenuRoute, direction: -1 | 1): void {
    const outgoing = this.currentView;
    const incoming = this.buildScreen(route);
    this.layer.add(incoming.root);
    this.currentView = incoming;
    this.currentRoute = route;
    this.onRouteChanged(route, this.history);

    if (!outgoing || this.reducedMotion) {
      outgoing?.root.destroy(true);
      incoming.root.setPosition(0, 0).setAlpha(1);
      this.transitioning = false;
      return;
    }

    this.transitioning = true;
    incoming.root.setX(direction * MENU_MOTION.distance).setAlpha(0);
    this.scene.tweens.add({
      targets: outgoing.root,
      x: -direction * MENU_MOTION.distance,
      alpha: 0,
      duration: MENU_MOTION.base,
      ease: MENU_MOTION.ease,
      onComplete: () => outgoing.root.destroy(true),
    });
    this.scene.tweens.add({
      targets: incoming.root,
      x: 0,
      alpha: 1,
      duration: MENU_MOTION.base,
      ease: MENU_MOTION.ease,
      onComplete: () => {
        this.transitioning = false;
      },
    });
  }
}