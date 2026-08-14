import {
  DEFAULT_MAGE_CLASS,
  MAGE_CLASSES,
  toMageClass,
  type MageClass,
} from '../../core/Classes';
import {
  MODIFIER_WORDS,
  WORDS,
  WORD_ORDER,
  isModifierWord,
  type WordId,
} from '../../core/Words';
import {
  usesSwampPrep,
  type ItemSetSelection,
  type MatchConfig,
  type MatchMode,
  type SeatConfig,
  type SessionRole,
} from '../../config/MatchConfig';
import { Net, type NetMessage } from '../../net/Net';
import { RAID_BOSS_KINDS, type RaidBossKind } from '../../pve/swamprun';
import { MenuModel } from './MenuModel';

export type OnlineStage =
  | 'connecting'
  | 'waiting'
  | 'assembling'
  | 'starting'
  | 'error';

export interface OnlineStatus {
  stage: OnlineStage;
  message: string;
}

export interface OnlineConnectRequest {
  role: Exclude<SessionRole, 'local'>;
  room: string;
  url: string;
}

export function defaultRelayUrl(): string {
  const location = typeof window !== 'undefined' ? window.location : null;
  const host = location?.hostname ?? '';
  const local = host === '' || host === 'localhost' || host === '127.0.0.1';
  if (!location || local) return 'ws://localhost:8787/ws';
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

export function sanitizeOnlineLoadout(value: unknown): WordId[] {
  const source = Array.isArray(value) ? value : [];
  const words = source.filter((word): word is WordId => typeof word === 'string' && word in WORDS);
  const base = words.filter((word) => !isModifierWord(word)).slice(0, 5);
  if (base.length === 0) base.push('pierce');
  return [...base, words.find(isModifierWord) ?? MODIFIER_WORDS[0]];
}

export function sanitizeOnlineItemSets(value: unknown): ItemSetSelection {
  const source = (value ?? {}) as Partial<Record<keyof ItemSetSelection, unknown>>;
  const sets: ItemSetSelection = {
    original: !!source.original,
    finns: !!source.finns,
    dlc: !!source.dlc,
  };
  if (!sets.original && !sets.finns && !sets.dlc) sets.original = true;
  return sets;
}

export function sanitizeOnlineRaidBoss(value: unknown): RaidBossKind {
  return RAID_BOSS_KINDS.includes(value as RaidBossKind)
    ? value as RaidBossKind
    : 'deathknightSpear';
}

export function sanitizeOnlineSeats(value: unknown, size: number): SeatConfig[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: size }, (_, seat) => {
    const candidate = (source[seat] ?? {}) as Partial<SeatConfig>;
    return {
      name: typeof candidate.name === 'string' ? candidate.name.slice(0, 48) : `Player ${seat + 1}`,
      team: typeof candidate.team === 'number' && Number.isFinite(candidate.team)
        ? Math.max(1, Math.floor(candidate.team))
        : seat + 1,
      isAI: candidate.isAI === true,
      loadout: sanitizeOnlineLoadout(candidate.loadout),
      mageClass: toMageClass(candidate.mageClass),
    };
  });
}

export class OnlineCoordinator {
  private net: Net | null = null;
  private abortController: AbortController | null = null;
  private cancelled = false;

  constructor(
    private readonly model: MenuModel,
    private readonly report: (status: OnlineStatus) => void
  ) {}

  async connect(request: OnlineConnectRequest): Promise<MatchConfig> {
    const room = request.room.trim();
    const url = request.url.trim();
    if (!room) throw new Error('A room code is required.');
    if (!/^wss?:\/\//.test(url)) throw new Error('Relay URL must start with ws:// or wss://.');
    if (!this.model.loadoutReady(0)) throw new Error('Finish your mage build first.');
    if (request.role === 'host' && this.model.humanCount() < 2) {
      throw new Error('Online rooms require at least two human seats.');
    }

    const draft = this.model.draftFor(0);
    const myLoadout = [...draft.words, draft.modifier];
    const myClass = draft.mageClass;
    this.cancelled = false;
    this.abortController = new AbortController();
    this.report({ stage: 'connecting', message: 'Connecting to relay...' });

    try {
      this.net = await Net.connect(url, this.abortController.signal);
      this.throwIfCancelled();
      const humanSize = request.role === 'host' ? this.model.humanCount() : 0;
      this.net.send({ k: 'join', room, size: humanSize });

      const seatMessage = await this.waitFor('seat');
      const localSeat = Number(seatMessage.seat) | 0;
      const roomHumans = Math.max(2, Math.min(4, Number(seatMessage.size) || 2));
      this.report({
        stage: 'waiting',
        message: `Seat ${localSeat + 1} of ${roomHumans}. Waiting for players...`,
      });
      await this.waitFor('ready');
      this.net.send({ k: 'hello', seat: localSeat, loadout: myLoadout, class: myClass });

      const config = localSeat === 0
        ? await this.assembleHost(roomHumans, myLoadout, myClass)
        : await this.receiveGuest(localSeat, roomHumans);
      this.report({ stage: 'starting', message: 'Match assembled. Entering the arena...' });
      // Ownership transfers to GameScene through MatchConfig. Menu teardown must
      // not close a socket that has successfully completed the handshake.
      this.net = null;
      return config;
    } catch (error) {
      this.net?.close();
      this.net = null;
      const message = this.cancelled
        ? 'Connection cancelled.'
        : error instanceof Error
          ? error.message
          : 'Connection lost.';
      this.report({ stage: 'error', message });
      throw new Error(message);
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.abortController?.abort();
    this.net?.close();
    this.net = null;
  }

  private async assembleHost(
    roomHumans: number,
    myLoadout: WordId[],
    myClass: MageClass
  ): Promise<MatchConfig> {
    this.report({ stage: 'assembling', message: 'All players joined. Collecting mage builds...' });
    const loadouts = new Map<number, WordId[]>([[0, myLoadout]]);
    const classes = new Map<number, MageClass>([[0, myClass]]);
    while (loadouts.size < roomHumans) {
      const hello = await this.waitFor('hello');
      const seat = Number(hello.seat) | 0;
      if (seat < 0 || seat >= roomHumans) continue;
      loadouts.set(seat, sanitizeOnlineLoadout(hello.loadout));
      classes.set(seat, toMageClass(hello.class));
    }

    const totalSeats = Math.max(roomHumans, Math.min(4, this.model.seatCount));
    const seats = Array.from({ length: totalSeats }, (_, seat): SeatConfig => {
      const human = seat < roomHumans;
      return {
        name: human ? `Player ${seat + 1}` : totalSeats > 2 ? `AI ${seat + 1}` : 'AI',
        team: this.model.teamOf(seat),
        isAI: !human,
        loadout: human ? loadouts.get(seat) ?? this.randomAiLoadout() : this.randomAiLoadout(),
        mageClass: human ? classes.get(seat) ?? DEFAULT_MAGE_CLASS : this.randomClass(),
      };
    });
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) | 0;
    this.net?.send({
      k: 'start',
      mode: this.model.mode,
      seed,
      seats,
      itemSets: this.model.itemSets,
      swampPrepMode: usesSwampPrep(this.model.mode) ? this.model.prepMode : undefined,
      raidBoss: this.model.mode === 'raid' ? this.model.raidBoss : undefined,
    });
    return {
      mode: this.model.mode,
      loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
      seats,
      net: this.requireNet(),
      localTeam: seats[0].team,
      localSeat: 0,
      seed,
      itemSets: { ...this.model.itemSets },
      swampPrepMode: usesSwampPrep(this.model.mode) ? this.model.prepMode : undefined,
      raidBoss: this.model.mode === 'raid' ? this.model.raidBoss : undefined,
    };
  }

  private async receiveGuest(localSeat: number, roomHumans: number): Promise<MatchConfig> {
    this.report({ stage: 'assembling', message: 'Connected. Waiting for host rules...' });
    const start = await this.waitFor('start');
    const totalSeats = Array.isArray(start.seats)
      ? Math.max(2, Math.min(4, start.seats.length))
      : roomHumans;
    const seats = sanitizeOnlineSeats(start.seats, totalSeats);
    const seed = Number(start.seed) | 0;
    const mode = this.networkMode(start.mode);
    return {
      mode,
      loadouts: [seats[0].loadout, seats[1]?.loadout ?? []],
      seats,
      net: this.requireNet(),
      localTeam: seats[localSeat]?.team ?? 2,
      localSeat,
      seed,
      itemSets: sanitizeOnlineItemSets(start.itemSets),
      swampPrepMode: usesSwampPrep(mode)
        ? start.swampPrepMode === 'quick' || start.swampPrepMode === 'creative'
          ? start.swampPrepMode
          : 'custom'
        : undefined,
      raidBoss: mode === 'raid' ? sanitizeOnlineRaidBoss(start.raidBoss) : undefined,
    };
  }

  private async waitFor(kind: string): Promise<NetMessage> {
    for (;;) {
      this.throwIfCancelled();
      const message = await this.requireNet().recv();
      this.throwIfCancelled();
      if (message.k === kind) return message;
      if (message.k === 'full') throw new Error('That room is already full.');
      if (message.k === 'bye') throw new Error('Another player disconnected.');
    }
  }

  private networkMode(value: unknown): MatchMode {
    return value === 'swamprun' || value === 'minerun' || value === 'raid'
      ? value
      : 'online';
  }

  private randomAiLoadout(): WordId[] {
    const pool = [...WORD_ORDER];
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    const words = pool.slice(0, 5);
    if (!words.some((word) => WORDS[word].grantsReaction)) words[0] = 'mind';
    return [...words, MODIFIER_WORDS[Math.floor(Math.random() * MODIFIER_WORDS.length)]];
  }

  private randomClass(): MageClass {
    return MAGE_CLASSES[Math.floor(Math.random() * MAGE_CLASSES.length)] ?? DEFAULT_MAGE_CLASS;
  }

  private requireNet(): Net {
    if (!this.net) throw new Error('Connection closed.');
    return this.net;
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('Connection cancelled.');
  }
}