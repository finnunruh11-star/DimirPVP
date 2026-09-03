import Phaser from 'phaser';
import { playMusic, playSound } from '../audio';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { MatchConfig } from '../config/MatchConfig';
import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import {
  applyExplorationCommand,
  createRun,
  currentNode,
  type ExplorationRun,
  type TravelOutcome,
} from '../pve/exploration/run';
import { loadRun, saveRun } from '../pve/exploration/save';
import { createWorld, nodeAt, type NodeKind, type WorldMap, type WorldNode } from '../pve/exploration/world';
import { CabinetButton, MenuFocusGroup } from '../ui/cabinet/controls';
import { SceneInput } from '../engine/SceneInput';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';

/** What the scene was handed when it started. */
export interface ExplorationEntry {
  config?: MatchConfig;
  /** Pick the autosave back up instead of building a fresh run. */
  resume?: boolean;
  /** Handed back by GameScene once a fight is done. */
  result?: ExplorationCombatResult;
}

export interface ExplorationCombatResult {
  run: ExplorationRun;
  outcome: 'won' | 'lost' | 'fled';
  /** Border the party broke off by, when they fled. */
  edge?: 'north' | 'south' | 'east' | 'west';
  /** Where the party stood before walking into the fight. */
  cameFrom: string | null;
}

const NODE_COLOR: Record<NodeKind, number> = {
  city: MENU_COLOR.brassLight,
  path: 0x6f6455,
  dungeon: MENU_COLOR.blood,
  wilderness: 0xc4622d,
  wip: 0x4d4a55,
};

/**
 * The overworld. Owns the run, draws the map, and hands off to GameScene for
 * every fight. It is a scene of its own rather than another GameScene overlay
 * because GameScene is already far too large to take a second world on.
 */
export class ExplorationScene extends Phaser.Scene {
  private world: WorldMap = createWorld();
  private run!: ExplorationRun;
  private cameFrom: string | null = null;
  private layer?: Phaser.GameObjects.Container;
  private readonly focus = new MenuFocusGroup();
  private keys?: SceneInput;
  private notice = '';
  private pendingConfig?: MatchConfig;
  /** The party, rebuilt only when the run's snapshot actually changes. */
  private partyCache: { snapshot: unknown; mages: Mage[] } | null = null;

  private party(): Mage[] {
    if (this.partyCache?.snapshot !== this.run.party) {
      this.partyCache = { snapshot: this.run.party, mages: restoreParty(this.run.party) };
    }
    return this.partyCache.mages;
  }

  constructor() {
    super('Exploration');
  }

  create(entry: ExplorationEntry): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    playMusic('menu');
    this.world = createWorld();
    this.pendingConfig = entry.config;
    this.keys?.destroy();
    this.keys = new SceneInput(this);
    this.keys.bindKeys([
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'W', run: () => this.focus.move(-1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'S', run: () => this.focus.move(1) },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
    ]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.keys?.destroy());

    if (entry.result) {
      this.run = entry.result.run;
      this.resolveCombatResult(entry.result);
    } else {
      const saved = loadRun();
      // A run already on the road is never thrown away without being asked.
      if (saved) {
        this.run = saved;
        this.drawResumePrompt(saved);
        return;
      }
      this.run = createRun(this.freshSeed(), this.buildParty(entry.config));
      this.notice = 'You set out from the Capitol.';
    }

    saveRun(this.run);
    this.draw();
  }

  private freshSeed(): number {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  /** Standing offer when an old run is found: pick it up, or set it down. */
  private drawResumePrompt(saved: ExplorationRun): void {
    this.layer?.destroy();
    this.focus.clear();
    const root = this.add.container(0, 0);
    this.layer = root;
    const where = nodeAt(this.world, saved.nodeId);
    root.add(
      this.add.text(GAME_WIDTH / 2, 220, 'A RUN IS ALREADY ON THE ROAD', {
        fontFamily: MENU_FONT.display,
        fontSize: '30px',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5)
    );
    root.add(
      this.add.text(
        GAME_WIDTH / 2,
        266,
        `${where.name} \u00b7 ${saved.gold}g \u00b7 ${saved.steps} leagues walked`,
        { fontFamily: MENU_FONT.control, fontSize: '16px', color: MENU_HEX.bone }
      ).setOrigin(0.5)
    );
    const options: [string, string, () => void][] = [
      ['Continue', `Pick up at ${where.name}`, () => {
        this.notice = 'The road is where you left it.';
        this.draw();
      }],
      ['Start Over', 'Abandon that run and set out fresh', () => {
        this.run = createRun(this.freshSeed(), this.buildParty(this.pendingConfig));
        this.notice = 'You set out from the Capitol.';
        saveRun(this.run);
        this.draw();
      }],
      ['Back', 'Return to the main menu', () => this.scene.start('Menu')],
    ];
    options.forEach(([label, detail, run], index) => {
      const button = new CabinetButton(this, GAME_WIDTH / 2 - 170, 330 + index * 74, {
        width: 340,
        label,
        detail,
        index: String(index + 1),
        onActivate: run,
      });
      root.add(button);
      this.focus.add(button);
    });
  }

  /** A fresh traveller: Expedition's build, standing in the Capitol. */
  private buildParty(config?: MatchConfig): ReturnType<typeof capturePartySnapshot> {
    const seat = config?.seats?.[0];
    const mage = new Mage({
      name: seat?.name ?? 'Traveller',
      isAI: false,
      team: 1,
      position: { x: 200, y: 240 },
      loadout: seat?.loadout ?? [],
      mageClass: seat?.mageClass,
    });
    mage.assignFlatStats(3);
    mage.bag.push('torch');
    return capturePartySnapshot([mage]);
  }

  // ---------------------------------------------------------------------------
  //  COMBAT ROUND TRIP
  // ---------------------------------------------------------------------------

  private resolveCombatResult(result: ExplorationCombatResult): void {
    this.cameFrom = result.cameFrom;
    if (result.outcome === 'lost') {
      this.notice = 'You were carried back to the Capitol with nothing but your life.';
      this.run.nodeId = 'capitol';
      return;
    }
    if (result.outcome === 'fled' && result.edge) {
      const destination = this.fleeTarget(result.edge, result.cameFrom);
      this.run.nodeId = destination;
      this.notice =
        destination === result.cameFrom
          ? 'You broke off and fell back the way you came.'
          : destination === this.run.nodeId
            ? 'You broke off, but the road held you where you stood.'
            : 'You broke off and pushed on past the ambush.';
      return;
    }
    this.notice = 'The road is clear again.';
  }

  /** Running back the way you came retreats; running onward skips the fight. */
  private fleeTarget(edge: 'north' | 'south' | 'east' | 'west', cameFrom: string | null): string {
    const node = nodeAt(this.world, this.run.nodeId);
    if (node.kind !== 'path') return this.run.nodeId;
    if (edge === 'west' && cameFrom && node.links.includes(cameFrom)) return cameFrom;
    if (edge === 'east') return node.links.find((id) => id !== cameFrom) ?? this.run.nodeId;
    return this.run.nodeId;
  }

  private startCombat(outcome: TravelOutcome): void {
    saveRun(this.run);
    this.scene.start('Game', {
      mode: 'exploration',
      loadouts: [[], []],
      exploration: {
        run: this.run,
        encounter: outcome.encounter,
        depth: outcome.depth,
        cameFrom: this.cameFrom,
      },
    } satisfies MatchConfig);
  }

  // ---------------------------------------------------------------------------
  //  TRAVEL
  // ---------------------------------------------------------------------------

  private travel(to: string): void {
    const from = this.run.nodeId;
    const outcome = applyExplorationCommand(this.run, { t: 'travel', to }, this.world);
    if (!outcome) return;
    this.cameFrom = from;
    saveRun(this.run);

    if (outcome.encounter === 'robbery' || outcome.encounter === 'monsters') {
      this.notice =
        outcome.encounter === 'robbery' ? 'Ambushed on the road!' : 'Something blocks the way.';
      this.startCombat(outcome);
      return;
    }
    if (outcome.encounter === 'event') {
      this.rollEvent(outcome);
      return;
    }
    this.notice = `You reach ${outcome.node.name}.`;
    this.draw();
  }

  /** Small roadside happenings. Deliberately light: no fight, just a moment. */
  private rollEvent(outcome: TravelOutcome): void {
    const rng = new Dice(this.run.steps * 7919 + this.run.seed);
    const purse = rng.die(4);
    const events = [
      () => {
        applyExplorationCommand(this.run, { t: 'earn', gold: purse });
        return `A traveller pays you ${purse}g for directions.`;
      },
      () => 'You help a carter free a stuck wheel. They have nothing to give but thanks.',
      () => {
        applyExplorationCommand(this.run, { t: 'earn', gold: purse });
        return `You find ${purse}g in an abandoned camp.`;
      },
      () => 'A shrine by the road stands cold and unattended.',
    ];
    this.notice = `${outcome.node.name}: ${events[rng.die(events.length) - 1]()}`;
    saveRun(this.run);
    this.draw();
  }

  private enterHere(): void {
    const node = currentNode(this.run, this.world);
    if (node.kind === 'wip') {
      this.notice = node.note ?? 'Nothing here yet.';
    } else if (node.kind === 'dungeon') {
      this.notice = `${node.name} is not yet open from the overworld.`;
    } else if (node.kind === 'wilderness') {
      this.notice = `${node.name} is not yet mapped.`;
    } else if (node.kind === 'city') {
      this.notice = `${node.name} has no open doors yet.`;
    }
    this.draw();
  }

  // ---------------------------------------------------------------------------
  //  DRAWING
  // ---------------------------------------------------------------------------

  private draw(): void {
    this.layer?.destroy();
    this.focus.clear();
    const root = this.add.container(0, 0);
    this.layer = root;

    const here = currentNode(this.run, this.world);
    root.add(this.drawMap(here));
    root.add(this.drawHeader(here));
    this.drawControls(root, here);
  }

  private drawHeader(here: WorldNode): Phaser.GameObjects.GameObject[] {
    const party = this.party();
    const carried = party.reduce((sum, m) => sum + m.carriedWeight(), 0);
    const capacity = party.reduce((sum, m) => sum + m.carryCap(), 0);
    const hp = party.reduce((sum, m) => sum + m.hp, 0);
    const maxHp = party.reduce((sum, m) => sum + m.maxHp, 0);
    const title = this.add
      .text(40, 28, here.name.toUpperCase(), {
        fontFamily: MENU_FONT.display,
        fontSize: '30px',
        color: MENU_HEX.brassLight,
      })
      .setOrigin(0, 0);
    const stats = this.add
      .text(
        40,
        66,
        `${this.run.gold}g   ·   ${hp}/${maxHp} HP   ·   ${carried.toFixed(1)}/${Number.isFinite(capacity) ? capacity : '\u221e'}kg   ·   depth ${here.depth}   ·   ${this.run.steps} leagues walked`,
        { fontFamily: MENU_FONT.control, fontSize: '14px', color: MENU_HEX.bone }
      )
      .setOrigin(0, 0);
    const note = this.add
      .text(40, 90, this.notice, {
        fontFamily: MENU_FONT.control,
        fontSize: '14px',
        color: '#ffd978',
        wordWrap: { width: GAME_WIDTH - 400 },
      })
      .setOrigin(0, 0);
    return [title, stats, note];
  }

  private drawMap(here: WorldNode): Phaser.GameObjects.GameObject[] {
    const g = this.add.graphics().setDepth(1);
    const drawn = new Set<string>();
    for (const node of this.world.values()) {
      for (const link of node.links) {
        const key = [node.id, link].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const to = nodeAt(this.world, link);
        const known = this.run.visited.includes(node.id) || this.run.visited.includes(link);
        g.lineStyle(known ? 2 : 1, known ? 0x6f6455 : 0x3a3630, known ? 0.9 : 0.5);
        g.lineBetween(node.at.x, node.at.y, to.at.x, to.at.y);
      }
    }

    const labels: Phaser.GameObjects.GameObject[] = [g];
    for (const node of this.world.values()) {
      const reachable = here.links.includes(node.id);
      const seen = this.run.visited.includes(node.id);
      const isHere = node.id === here.id;
      const place = node.kind !== 'path';
      const radius = place ? 12 : 5;
      g.fillStyle(NODE_COLOR[node.kind], isHere ? 1 : seen || reachable ? 0.85 : 0.35);
      g.fillCircle(node.at.x, node.at.y, radius);
      if (isHere) {
        g.lineStyle(3, MENU_COLOR.brassLight, 1).strokeCircle(node.at.x, node.at.y, radius + 7);
      } else if (reachable) {
        g.lineStyle(1, MENU_COLOR.brassLight, 0.8).strokeCircle(node.at.x, node.at.y, radius + 4);
      }
      if (place && (seen || reachable || isHere)) {
        labels.push(
          this.add
            .text(node.at.x, node.at.y + radius + 6, node.name, {
              fontFamily: MENU_FONT.control,
              fontSize: '12px',
              color: isHere ? MENU_HEX.brassLight : MENU_HEX.bone,
            })
            .setOrigin(0.5, 0)
            .setDepth(2)
        );
      }
    }
    return labels;
  }

  private drawControls(root: Phaser.GameObjects.Container, here: WorldNode): void {
    const x = GAME_WIDTH - 330;
    let y = 130;
    const add = (label: string, detail: string, run: () => void, enabled = true): void => {
      const button = new CabinetButton(this, x, y, {
        width: 300,
        label,
        detail,
        enabled,
        onActivate: run,
      });
      root.add(button);
      this.focus.add(button);
      y += 62;
    };

    if (here.kind !== 'path') {
      add('Enter', here.name, () => this.enterHere());
    }

    for (const id of here.links) {
      const node = nodeAt(this.world, id);
      const seen = this.run.visited.includes(id);
      add(
        node.kind === 'path' ? `Take the ${node.name}` : `Go to ${node.name}`,
        seen ? 'Travelled before' : 'Unwalked',
        () => this.travel(id)
      );
    }

    y = GAME_HEIGHT - 80;
    const leave = new CabinetButton(this, x, y, {
      width: 300,
      label: 'Save and Leave',
      detail: 'Return to the main menu',
      onActivate: () => {
        saveRun(this.run);
        playSound('ui.back');
        this.scene.start('Menu');
      },
    });
    root.add(leave);
    this.focus.add(leave);
  }
}
