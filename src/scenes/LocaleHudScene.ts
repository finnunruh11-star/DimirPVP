// The heads-up layer over a walkable place: vitals, gold and bounties pinned to
// the screen, the "talk" prompt, and every modal window (shops, pack, level-ups,
// menus). A scene of its own so the world camera can scroll underneath it.

import Phaser from 'phaser';
import { playSound } from '../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import { MAGE_CLASS_DEFS, type MageClass } from '../core/Classes';
import { SceneInput } from '../engine/SceneInput';
import { bountyProgress } from '../pve/exploration/bounties';
import { dayNews } from '../pve/exploration/calendar';
import { levelsOwed, partyXpScale } from '../pve/exploration/coop';
import { memberIn, moneyLabel, partyOf } from '../pve/exploration/economy';
import type { ExplorationActions } from '../pve/exploration/intents';
import { questLines } from '../pve/exploration/quest';
import type { ExplorationRun } from '../pve/exploration/run';
import { shopById } from '../pve/exploration/shops';
import { xpToNext } from '../pve/progression';
import { CabinetChip, MenuFocusGroup } from '../ui/cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX, MENU_MOTION } from '../ui/cabinet/theme';
import { isReducedMotion } from '../ui/cabinet/motion';
import { prefersTouchLayout } from '../config/device';
import { siteGoals } from '../pve/exploration/site';
import { drawPlate, EasedBar, KeyLegend, PromptPlate, ToastRail } from '../ui/pve/HudParts';
import { bloodmoonDue, bloodmoonOmen } from '../pve/exploration/bloodmoon';
import { playBloodmoonRise } from '../ui/combat/BossIntro';
import { ChoiceMenuView } from '../ui/combat/CombatMenus';
import { playDayCard, type DayCard } from '../ui/pve/DayAnnouncement';
import { resolvePendingLevels } from '../ui/pve/LevelUpFlow';
import { PackView } from '../ui/pve/PackView';
import { SearchView, type SearchViewHooks, type SearchViewModel, type SearchViewResult } from '../ui/pve/SearchView';
import { ShopView } from '../ui/pve/ShopView';
import { SightingCard, type SightingCardModel } from '../ui/pve/SightingCard';
import { TimeWheel } from '../ui/pve/TimeWheel';

export interface HudOwner {
  onHudReady(hud: LocaleHudScene): void;
  /** Touch controls: a button was pressed, read like its key. */
  tap?(button: string): void;
  /** Touch controls: the act button is held down. */
  setTouchHold?(on: boolean): void;
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

const OMEN_WARNINGS: readonly [number, string][] = [
  [18, 'The sky reddens. The bloodmoon rises at midnight, and its boss with it.'],
  [22, 'Two hours until the bloodmoon.'],
];

export class LocaleHudScene extends Phaser.Scene {
  private frame?: Phaser.GameObjects.Graphics;
  private title?: Phaser.GameObjects.Text;
  private line?: Phaser.GameObjects.Text;
  private bars?: Phaser.GameObjects.Graphics;
  private barText?: Phaser.GameObjects.Text;
  private partyText?: Phaser.GameObjects.Text;
  private bountyText?: Phaser.GameObjects.Text;
  private journalBack?: Phaser.GameObjects.Graphics;
  private partyBack?: Phaser.GameObjects.Graphics;
  private partyRows: Phaser.GameObjects.Text[] = [];
  private vitals: EasedBar[] = [];
  private prompt?: PromptPlate;
  private toasts?: ToastRail;
  private legend?: KeyLegend;
  private wordBar?: Phaser.GameObjects.Text;
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
  /** The party member this player controls; null means the leader. */
  private member: MageClass | null = null;
  /** The shop or pack window on screen, redrawn when the run changes under it. */
  private window: ShopView | PackView | null = null;
  /** The clock as last seen, so a warning fires once as its hour is passed. */
  private omenSeen: { day: number; hour: number } | null = null;

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
    this.window = null;
    this.omenSeen = null;
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
    drawPlate(this.frame, 12, 10, 372, 104);
    this.title = this.add.text(26, 18, '', { fontFamily: MENU_FONT.display, fontSize: '20px', fontStyle: 'bold', color: MENU_HEX.brassLight });
    this.line = this.add.text(26, 46, '', { fontFamily: MENU_FONT.control, fontSize: '13px', color: MENU_HEX.bone });
    this.bars = this.add.graphics();
    this.vitals = [
      new EasedBar(26, 86, 108, 10, 0xb8453c),
      new EasedBar(142, 86, 108, 10, 0x4a7fd0),
      new EasedBar(258, 86, 108, 10, 0x8a5fb8),
    ];
    this.barText = this.add.text(26, 66, '', { fontFamily: MENU_FONT.control, fontSize: '11px', color: MENU_HEX.boneDim });
    this.partyBack = this.add.graphics();
    this.partyRows = [];
    this.journalBack = this.add.graphics();
    this.bountyText = this.add.text(GAME_WIDTH - 28, 24, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      align: 'right',
      lineSpacing: 2,
      wordWrap: { width: 460 },
    }).setOrigin(1, 0);
    this.legend = new KeyLegend(this, 24, GAME_HEIGHT - 30);
    this.legend.set('WASD / arrows or click: walk     E: talk     I: pack     Esc: menu');
    this.wordBar = this.add.text(16, GAME_HEIGHT - 46, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.bone,
      backgroundColor: '#17110d',
      padding: { x: 10, y: 5 },
    }).setOrigin(0, 1).setVisible(false);
    this.prompt = new PromptPlate(this, GAME_WIDTH / 2, GAME_HEIGHT - 92);
    this.toasts = new ToastRail(this, GAME_WIDTH / 2, 160);
    const touch = prefersTouchLayout() && !!data.owner.tap;
    this.legend.setVisible(!touch);
    if (touch) this.buildDock(data.owner);
    this.wheel = new TimeWheel(this, GAME_WIDTH / 2);
    data.owner.onHudReady(this);
  }

  update(_time: number, delta: number): void {
    this.wheel?.update(delta);
    let moved = false;
    for (const bar of this.vitals) moved = bar.step(delta) || moved;
    if (moved) this.drawVitals();
  }

  private drawVitals(): void {
    const g = this.bars;
    if (!g) return;
    g.clear();
    for (const bar of this.vitals) bar.draw(g);
  }

  /** Touch: big act button (held for finds that take a moment) and the other keys beside it. */
  private buildDock(owner: HudOwner): void {
    const size = 92;
    const right = GAME_WIDTH - 20;
    const bottom = GAME_HEIGHT - 20;
    const button = (x: number, y: number, w: number, h: number, label: string, id: string): void => {
      const g = this.add.graphics();
      const draw = (down: boolean): void => {
        g.clear();
        g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y + 3, w, h - 3);
        g.fillStyle(down ? MENU_COLOR.wood : MENU_COLOR.woodRaised, 1).fillRect(x, y + (down ? 3 : 0), w, h - 3);
        g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y + (down ? 3 : 0), w, 2);
        text.setY(y + h / 2 + (down ? 2 : 0));
      };
      const text = this.add.text(x + w / 2, y + h / 2, label, {
        fontFamily: MENU_FONT.control, fontSize: id === 'act' ? '20px' : '13px', fontStyle: 'bold', color: MENU_HEX.bone,
      }).setOrigin(0.5).setDepth(41);
      g.setDepth(40);
      draw(false);
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive().setDepth(42);
      const release = (): void => {
        draw(false);
        if (id === 'act') owner.setTouchHold?.(false);
      };
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        draw(true);
        owner.tap?.(id);
        if (id === 'act') owner.setTouchHold?.(true);
      });
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, release);
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, release);
    };
    button(right - size, bottom - size, size, size, 'ACT', 'act');
    const small = [['CAST', 'cast'], ['AMBUSH', 'strike'], ['SNEAK', 'sneak'], ['SEARCH', 'search'], ['REST', 'rest'], ['PACK', 'pack'], ['MENU', 'menu']];
    const w = 76;
    const h = 40;
    small.forEach(([label, id], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      button(right - size - 12 - (2 - col) * (w + 8) + 8, bottom - (row + 1) * (h + 8) + 8, w, h, label, id);
    });
  }

  /** Which party member this player controls; its bars fill the frame. */
  setMember(member: MageClass | null): void {
    this.member = member;
  }

  refresh(run: ExplorationRun, place: string, extra = ''): void {
    const leader = memberIn(run, this.member);
    this.title?.setText(place.toUpperCase());
    this.line?.setText(`${moneyLabel(run.gold)}   Level ${run.level}  (${run.xp}/${xpToNext(run.level, partyXpScale(run))} XP)${extra ? `   ${extra}` : ''}`);
    this.wheel?.setTime(run.day, run.hour);
    // The bloodmoon's own arrival replaces its day's card.
    const due = bloodmoonDue(run);
    if (this.shownDay && run.day > this.shownDay && !due) {
      this.announceDay({ day: run.day, hour: run.hour, news: dayNews(run), omen: bloodmoonOmen(run.day) });
    }
    this.warnBloodmoon(run, due);
    this.shownDay = run.day;
    const g = this.bars;
    if (g && leader) {
      this.vitals[0]?.set(leader.hp, leader.maxHp);
      this.vitals[1]?.set(leader.mana, leader.maxMana);
      this.vitals[2]?.set(leader.sanity, leader.maxSanity);
      this.drawVitals();
      this.barText?.setText(leader.alive
        ? `HP ${leader.hp}/${leader.maxHp}                      Mana ${leader.mana}/${leader.maxMana}                   Sanity ${leader.sanity}/${leader.maxSanity}`
        : 'FALLEN. Back on your feet after a night at an inn.');
    }
    const party = partyOf(run);
    const others = party.length > 1 ? party.filter((mage) => mage.mageClass !== leader?.mageClass) : [];
    this.drawParty(run, others);
    const lines = run.bounties.map((b) => `${b.label}  ${bountyProgress(run, b)}/${b.count}`);
    const quest = questLines(run);
    const site = run.area?.site;
    const goals = site
      ? [site.title.toUpperCase(), ...siteGoals(run, site).map((goal) => `${goal.label}${goal.optional ? '  (optional)' : ''}  ${goal.done ? '\u25A0' : '\u25A1'}`)]
      : [];
    const panel = [
      ...goals,
      ...(goals.length && quest.length ? [''] : []),
      ...quest,
      ...((goals.length || quest.length) && lines.length ? [''] : []),
      ...(lines.length ? ['BOUNTIES', ...lines] : []),
    ];
    const text = this.bountyText;
    const back = this.journalBack;
    if (text && back) {
      text.setText(panel.join('\n')).setVisible(panel.length > 0);
      back.clear();
      if (panel.length) drawPlate(back, GAME_WIDTH - 40 - Math.ceil(text.width), 14, Math.ceil(text.width) + 24, Math.ceil(text.height) + 22);
    }
  }

  /** The rest of the party: a name and three thin bars each. */
  private drawParty(run: ExplorationRun, others: ReturnType<typeof partyOf>): void {
    const g = this.partyBack;
    if (!g) return;
    g.clear();
    while (this.partyRows.length > others.length) this.partyRows.pop()?.destroy();
    while (this.partyRows.length < others.length) {
      this.partyRows.push(this.add.text(24, 0, '', { fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.bone }));
    }
    if (!others.length) return;
    drawPlate(g, 12, 120, 372, 14 + others.length * 24);
    others.forEach((mage, index) => {
      const y = 130 + index * 24;
      const owed = levelsOwed(run, mage.mageClass) > 0 ? '  +LV' : '';
      const name = `${mage.name} (${MAGE_CLASS_DEFS[mage.mageClass].label})`.slice(0, 26);
      this.partyRows[index].setPosition(24, y).setText(`${name}${owed}`).setColor(mage.alive ? MENU_HEX.bone : MENU_HEX.disabled);
      if (!mage.alive) {
        g.fillStyle(MENU_COLOR.blood, 1).fillRect(210, y + 5, 158, 6);
        return;
      }
      const bar = (x: number, value: number, max: number, color: number): void => {
        g.fillStyle(MENU_COLOR.ink, 1).fillRect(x, y + 5, 50, 6);
        g.fillStyle(color, 1).fillRect(x, y + 5, Math.round(50 * Math.max(0, Math.min(1, max > 0 ? value / max : 0))), 6);
      };
      bar(210, mage.hp, mage.maxHp, 0xb8453c);
      bar(264, mage.mana, mage.maxMana, 0x4a7fd0);
      bar(318, mage.sanity, mage.maxSanity, 0x8a5fb8);
    });
  }

  setHint(text: string): void {
    this.legend?.set(text);
  }

  /** On the bloodmoon's last day, a warning at dusk and another two hours before it rises. */
  private warnBloodmoon(run: ExplorationRun, due: boolean): void {
    const seen = this.omenSeen;
    this.omenSeen = { day: run.day, hour: run.hour };
    if (!seen || seen.day !== run.day || due || !bloodmoonOmen(run.day).tonight) return;
    for (const [hour, text] of OMEN_WARNINGS) {
      if (seen.hour >= hour || run.hour < hour) continue;
      this.toast(text, 5600);
      playSound('boss.omen');
      this.wheel?.pulse();
    }
  }

  /** The bloodmoon rises over whatever is on screen; resolves on black. */
  bloodmoonRise(): Promise<void> {
    this.prompt?.set(null, false);
    return playBloodmoonRise(this, isReducedMotion());
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
    drawPlate(back, left, top, width, height);
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
    this.prompt?.set(text, !this.modalOpen);
  }

  /** How far a held action has filled, 0..1; null when nothing is held. */
  setHoldProgress(t: number | null): void {
    this.prompt?.setHold(t);
  }

  toast(message: string, ms = 3200): void {
    if (message) this.toasts?.push(message, ms);
  }

  private hold<T>(open: (done: (value: T) => void) => void, animate = true): Promise<T> {
    this.modal += 1;
    this.prompt?.setVisible(false);
    playSound('ui.open');
    return new Promise<T>((resolve) => {
      // Built next tick, so the key press that opened a window cannot also act inside it.
      this.time.delayedCall(0, () => {
        const before = new Set(this.children.list);
        open((value) => {
          this.modal = Math.max(0, this.modal - 1);
          playSound('ui.close');
          if (!this.modalOpen && this.pendingCard) {
            const card = this.pendingCard;
            this.pendingCard = null;
            this.announceDay(card);
          }
          resolve(value);
        });
        if (animate && !isReducedMotion()) this.enter(this.children.list.filter((child) => !before.has(child)));
      });
    });
  }

  /** A window just built settles in: it fades up and its panels rise into place. */
  private enter(objects: Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) {
      const item = object as Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.Alpha>;
      if (typeof item.alpha !== 'number' || !item.setAlpha || item.alpha === 0) continue;
      const alpha = item.alpha;
      item.setAlpha(0);
      this.tweens.add({ targets: item, alpha, duration: MENU_MOTION.base, ease: MENU_MOTION.ease });
      if (object instanceof Phaser.GameObjects.Container) {
        const y = object.y;
        object.y = y + 14;
        this.tweens.add({ targets: object, y, duration: MENU_MOTION.base, ease: 'Cubic.Out' });
      }
    }
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
    }, false);
  }

  openShop(run: ExplorationRun, shopId: string, townId: string, changed: () => void, actions: ExplorationActions): Promise<void> {
    const shop = shopById(shopId);
    if (!shop) return Promise.resolve();
    return this.hold<void>((done) => {
      const view: ShopView = new ShopView(this, run, shop, {
        townId,
        portrait: `keeper:${shop.keeper}`,
        changed,
        actions,
        close: () => {
          if (this.window === view) this.window = null;
          view.destroy();
          done();
        },
      });
      this.window = view;
    });
  }

  openPack(run: ExplorationRun, changed: () => void, actions: ExplorationActions): Promise<void> {
    return this.hold<void>((done) => {
      const view: PackView = new PackView(this, run, {
        changed,
        actions,
        close: () => {
          if (this.window === view) this.window = null;
          view.destroy();
          done();
        },
      });
      this.window = view;
    });
  }

  /** Redraw an open shop or pack after the run changed under it. */
  refreshWindow(): void {
    this.window?.refresh();
  }

  /** The search window: pick a target, roll for it. Null when the player backs out. */
  search(model: SearchViewModel, roll: SearchViewHooks['roll']): Promise<SearchViewResult | null> {
    return this.hold<SearchViewResult | null>((done) => {
      this.worldPanel?.setVisible(false);
      const view: SearchView = new SearchView(this, model, {
        roll,
        close: (result) => {
          view.destroy();
          this.worldPanel?.setVisible(true);
          done(result);
        },
      });
    });
  }

  levelUps(run: ExplorationRun, actions: ExplorationActions): Promise<boolean> {
    const owed = actions.member ? levelsOwed(run, actions.member) : run.pendingLevels;
    if (owed <= 0) return Promise.resolve(false);
    return this.hold<boolean>((done) => {
      void resolvePendingLevels(this, run, actions).then(done);
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
