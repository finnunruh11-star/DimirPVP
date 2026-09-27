// The heads-up layer over a walkable place: vitals, gold and bounties pinned to
// the screen, the "talk" prompt, and every modal window (shops, pack, level-ups,
// menus). A scene of its own so the world camera can scroll underneath it.

import Phaser from 'phaser';
import { playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import { SceneInput } from '../engine/SceneInput';
import { bountyProgress } from '../pve/exploration/bounties';
import { dayNews } from '../pve/exploration/calendar';
import { moneyLabel, partyOf } from '../pve/exploration/economy';
import { questLines } from '../pve/exploration/quest';
import type { ExplorationRun } from '../pve/exploration/run';
import { shopById } from '../pve/exploration/shops';
import { xpToNext } from '../pve/progression';
import { CabinetChip, MenuFocusGroup } from '../ui/cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import { ChoiceMenuView } from '../ui/combat/CombatMenus';
import { playDayCard, type DayCard } from '../ui/pve/DayAnnouncement';
import { resolvePendingLevels } from '../ui/pve/LevelUpFlow';
import { PackView } from '../ui/pve/PackView';
import { ShopView } from '../ui/pve/ShopView';
import { SightingCard, type SightingCardModel } from '../ui/pve/SightingCard';
import { TimeWheel } from '../ui/pve/TimeWheel';

export interface HudOwner {
  onHudReady(hud: LocaleHudScene): void;
}

export interface WorldPanelAction {
  id: string;
  label: string;
  enabled: boolean;
  tone?: 'primary' | 'normal' | 'danger';
}

/** The overworld's standing panel: where you are, where you are headed, what you can do. */
export interface WorldPanel {
  title: string;
  lines: string[];
  actions: WorldPanelAction[];
  onAction: (id: string) => void;
}

const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

export class LocaleHudScene extends Phaser.Scene {
  private frame?: Phaser.GameObjects.Graphics;
  private title?: Phaser.GameObjects.Text;
  private line?: Phaser.GameObjects.Text;
  private bars?: Phaser.GameObjects.Graphics;
  private barText?: Phaser.GameObjects.Text;
  private bountyText?: Phaser.GameObjects.Text;
  private promptPlate?: Phaser.GameObjects.Text;
  private toastText?: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private wordBar?: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private modal = 0;
  private worldPanel?: Phaser.GameObjects.Container;
  private worldFocus = new MenuFocusGroup();
  private worldModel: WorldPanel | null = null;
  private wheel?: TimeWheel;
  /** The day the HUD last showed; a later one gets its card. */
  private shownDay = 0;
  /** A day that turned while a window was open, announced once it closes. */
  private pendingCard: DayCard | null = null;
  private cardPlaying: Promise<void> | null = null;

  constructor() {
    super('LocaleHud');
  }

  get modalOpen(): boolean {
    return this.modal > 0;
  }

  create(data: { owner: HudOwner }): void {
    this.modal = 0;
    this.worldPanel = undefined;
    this.worldModel = null;
    this.worldFocus = new MenuFocusGroup();
    this.shownDay = 0;
    this.pendingCard = null;
    this.cardPlaying = null;
    const panelKey = (run: () => void) => (): void => {
      if (this.worldPanel && !this.modalOpen) run();
    };
    new SceneInput(this).bindKeys([
      { key: 'UP', capture: true, run: panelKey(() => this.worldFocus.move(-1)) },
      { key: 'DOWN', capture: true, run: panelKey(() => this.worldFocus.move(1)) },
      { key: 'ENTER', capture: true, run: panelKey(() => this.worldFocus.activate()) },
      { key: 'SPACE', capture: true, run: panelKey(() => this.worldFocus.activate()) },
      ...DIGITS.map((key, index) => ({ key, run: panelKey(() => this.worldAction(index)) })),
    ]);
    this.frame = this.add.graphics();
    this.frame.fillStyle(MENU_COLOR.pitch, 0.82).fillRect(12, 10, 372, 104);
    this.frame.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(12.5, 10.5, 371, 103);
    this.frame.fillStyle(MENU_COLOR.brass, 1).fillRect(12, 10, 372, 3);
    this.title = this.add.text(26, 18, '', { fontFamily: MENU_FONT.display, fontSize: '20px', fontStyle: 'bold', color: MENU_HEX.brassLight });
    this.line = this.add.text(26, 46, '', { fontFamily: MENU_FONT.control, fontSize: '13px', color: MENU_HEX.bone });
    this.bars = this.add.graphics();
    this.barText = this.add.text(26, 66, '', { fontFamily: MENU_FONT.control, fontSize: '11px', color: MENU_HEX.boneDim });
    this.bountyText = this.add.text(GAME_WIDTH - 16, 14, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      align: 'right',
      backgroundColor: '#080907cc',
      padding: { x: 10, y: 6 },
      wordWrap: { width: 470 },
    }).setOrigin(1, 0);
    this.hintText = this.add.text(16, GAME_HEIGHT - 12, 'WASD / arrows or click: walk     E: talk     I: pack     Esc: menu', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      backgroundColor: '#080907aa',
      padding: { x: 8, y: 4 },
    }).setOrigin(0, 1);
    this.wordBar = this.add.text(16, GAME_HEIGHT - 42, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      backgroundColor: '#080907cc',
      padding: { x: 10, y: 5 },
    }).setOrigin(0, 1).setVisible(false);
    this.promptPlate = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 70, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '17px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: '#d2bd7f',
      padding: { x: 14, y: 7 },
    }).setOrigin(0.5).setVisible(false);
    this.toastText = this.add.text(GAME_WIDTH / 2, 132, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: '#ffe6a0',
      backgroundColor: '#080907dd',
      padding: { x: 14, y: 8 },
      align: 'center',
      wordWrap: { width: 760 },
    }).setOrigin(0.5, 0).setVisible(false);
    this.wheel = new TimeWheel(this, GAME_WIDTH / 2);
    data.owner.onHudReady(this);
  }

  update(_time: number, delta: number): void {
    this.wheel?.update(delta);
  }

  refresh(run: ExplorationRun, place: string, extra = ''): void {
    const leader = partyOf(run)[0];
    this.title?.setText(place.toUpperCase());
    this.line?.setText(`${moneyLabel(run.gold)}   Level ${run.level}  (${run.xp}/${xpToNext(run.level)} XP)${extra ? `   ${extra}` : ''}`);
    this.wheel?.setTime(run.day, run.hour);
    if (this.shownDay && run.day > this.shownDay) this.announceDay({ day: run.day, hour: run.hour, news: dayNews(run) });
    this.shownDay = run.day;
    const g = this.bars;
    if (g && leader) {
      g.clear();
      const bar = (x: number, value: number, max: number, color: number): void => {
        g.fillStyle(0x000000, 1).fillRect(x, 86, 108, 10);
        g.fillStyle(color, 1).fillRect(x, 86, Math.round(108 * Math.max(0, Math.min(1, max > 0 ? value / max : 0))), 10);
        g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, 86.5, 107, 9);
      };
      bar(26, leader.hp, leader.maxHp, 0xb8453c);
      bar(142, leader.mana, leader.maxMana, 0x4a7fd0);
      bar(258, leader.sanity, leader.maxSanity, 0x8a5fb8);
      this.barText?.setText(`HP ${leader.hp}/${leader.maxHp}                      Mana ${leader.mana}/${leader.maxMana}                   Sanity ${leader.sanity}/${leader.maxSanity}`);
    }
    const lines = run.bounties.map((b) => `${b.label}  ${bountyProgress(run, b)}/${b.count}`);
    const quest = questLines(run);
    const panel = [...quest, ...(quest.length && lines.length ? [''] : []), ...(lines.length ? ['BOUNTIES', ...lines] : [])];
    this.bountyText?.setText(panel.join('\n')).setVisible(panel.length > 0);
  }

  setHint(text: string): void {
    this.hintText?.setText(text);
  }

  /** The words the leader can speak here, with their charges; null hides the bar. */
  setWordBar(text: string | null): void {
    if (!this.wordBar) return;
    if (!text) {
      this.wordBar.setVisible(false);
      return;
    }
    if (this.wordBar.text !== text) this.wordBar.setText(text);
    this.wordBar.setVisible(true);
  }

  /** Show, replace or (with null) remove the overworld panel. */
  setWorldPanel(model: WorldPanel | null): void {
    this.worldPanel?.destroy();
    this.worldPanel = undefined;
    this.worldModel = model;
    this.worldFocus = new MenuFocusGroup();
    if (!model) return;
    const width = 400;
    const chipH = 32;
    const gap = 6;
    const lineH = 17;
    const height = 44 + model.lines.length * lineH + model.actions.length * (chipH + gap) + 8;
    const left = GAME_WIDTH - width - 16;
    const top = GAME_HEIGHT - 44 - height;
    const root = this.add.container(0, 0).setDepth(10);
    const back = this.add.graphics();
    back.fillStyle(MENU_COLOR.pitch, 0.86).fillRect(left, top, width, height);
    back.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    back.fillStyle(MENU_COLOR.brass, 1).fillRect(left, top, width, 3);
    root.add(back);
    // Clicks on the panel stay on the panel instead of planning a trip underneath.
    root.add(this.add.zone(left, top, width, height).setOrigin(0).setInteractive());
    root.add(this.add.text(left + 14, top + 12, model.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '17px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      fixedWidth: width - 28,
    }));
    model.lines.forEach((line, index) => {
      root.add(this.add.text(left + 14, top + 38 + index * lineH, line, {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.bone,
        fixedWidth: width - 28,
      }));
    });
    const chipsTop = top + 44 + model.lines.length * lineH;
    model.actions.forEach((action, index) => {
      const chip = new CabinetChip(this, left + 12, chipsTop + index * (chipH + gap), {
        width: width - 24,
        height: chipH,
        label: `${index + 1}   ${action.label}`,
        tone: action.tone ?? 'normal',
        enabled: action.enabled,
        onActivate: () => {
          if (!this.modalOpen) model.onAction(action.id);
        },
      });
      root.add(chip);
      this.worldFocus.add(chip);
    });
    this.worldPanel = root;
  }

  private worldAction(index: number): void {
    const action = this.worldModel?.actions[index];
    if (!action?.enabled) return;
    playSound('ui.click');
    this.worldModel?.onAction(action.id);
  }

  setPrompt(text: string | null): void {
    if (!this.promptPlate) return;
    if (!text) {
      this.promptPlate.setVisible(false);
      return;
    }
    if (this.promptPlate.text !== text) this.promptPlate.setText(text);
    this.promptPlate.setVisible(!this.modalOpen);
  }

  toast(message: string, ms = 3200): void {
    if (!this.toastText || !message) return;
    this.toastText.setText(message).setVisible(true).setAlpha(1);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(ms, () => {
      this.tweens.add({ targets: this.toastText, alpha: 0, duration: 400, onComplete: () => this.toastText?.setVisible(false) });
    });
  }

  private hold<T>(open: (done: (value: T) => void) => void): Promise<T> {
    this.modal += 1;
    this.promptPlate?.setVisible(false);
    playSound('ui.open');
    return new Promise<T>((resolve) => {
      // Built next tick, so the key press that opened a window cannot also act inside it.
      this.time.delayedCall(0, () => open((value) => {
        this.modal = Math.max(0, this.modal - 1);
        playSound('ui.close');
        if (!this.modalOpen && this.pendingCard) {
          const card = this.pendingCard;
          this.pendingCard = null;
          this.announceDay(card);
        }
        resolve(value);
      }));
    });
  }

  /** The day has turned: play its card, or keep it until the open window closes. */
  private announceDay(card: DayCard): void {
    if (this.modalOpen) {
      this.pendingCard = card;
      return;
    }
    const playing = playDayCard(this, card, () => this.wheel?.pulse()).then(() => {
      if (this.cardPlaying === playing) this.cardPlaying = null;
    });
    this.cardPlaying = playing;
  }

  /** Resolves once no day card is on screen. */
  dayShown(): Promise<void> {
    return this.cardPlaying ?? Promise.resolve();
  }

  /** Offer something spotted off the way. True when the party goes to it. */
  sighting(model: SightingCardModel): Promise<boolean> {
    return this.hold<boolean>((done) => {
      this.worldPanel?.setVisible(false);
      new SightingCard(this, model, (go) => {
        this.worldPanel?.setVisible(true);
        done(go);
      });
    });
  }

  openShop(run: ExplorationRun, shopId: string, townId: string, changed: () => void): Promise<void> {
    const shop = shopById(shopId);
    if (!shop) return Promise.resolve();
    return this.hold<void>((done) => {
      const view: ShopView = new ShopView(this, run, shop, {
        townId,
        portrait: `keeper:${shop.keeper}`,
        changed,
        close: () => {
          view.destroy();
          done();
        },
      });
    });
  }

  openPack(run: ExplorationRun, changed: () => void): Promise<void> {
    return this.hold<void>((done) => {
      const view: PackView = new PackView(this, run, {
        changed,
        close: () => {
          view.destroy();
          done();
        },
      });
    });
  }

  levelUps(run: ExplorationRun): Promise<boolean> {
    if (run.pendingLevels <= 0) return Promise.resolve(false);
    return this.hold<boolean>((done) => {
      void resolvePendingLevels(this, run).then(done);
    });
  }

  choose<T extends string>(title: string, subtitle: string, options: { id: T; label: string; detail: string; enabled?: boolean }[], cancel?: T): Promise<T> {
    return this.hold<T>((done) => {
      const view: ChoiceMenuView<T> = new ChoiceMenuView<T>(this, title, subtitle, options, (id) => {
        view.destroy();
        done(id);
      }, cancel ? () => {
        view.destroy();
        done(cancel);
      } : undefined);
    });
  }
}
