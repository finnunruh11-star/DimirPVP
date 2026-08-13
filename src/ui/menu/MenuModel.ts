import {
  DEFAULT_MAGE_CLASS,
  MAGE_CLASSES,
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
  MODE_CAPABILITIES,
  isPveRunMode,
  usesSwampPrep,
  type ItemSetSelection,
  type MatchConfig,
  type MatchMode,
  type ModeCapability,
  type SeatConfig,
  type SessionRole,
  type SwampPrepMode,
  type TeamFormat,
} from '../../config/MatchConfig';
import { RAID_BOSS_KINDS, type RaidBossKind } from '../../pve/swamprun';

export interface MageDraft {
  words: WordId[];
  mageClass: MageClass;
  modifier: WordId;
}

export type SecretPreset = 'NAD' | 'KAT' | 'GEN' | 'SNIFF';

const PRESET_LOADOUTS: Record<SecretPreset, readonly WordId[]> = {
  NAD: ['mind', 'shatter', 'twist', 'reality'],
  KAT: ['corrode', 'curse', 'shadow', 'drain', 'death'],
  GEN: ['order', 'curse', 'drain', 'slash'],
  SNIFF: ['pierce', 'mind', 'veil', 'fire', 'lightning'],
};

const makeDraft = (): MageDraft => ({
  words: [],
  mageClass: DEFAULT_MAGE_CLASS,
  modifier: MODIFIER_WORDS[0],
});

const shuffled = <T>(values: readonly T[], random: () => number): T[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

export class MenuModel {
  mode: MatchMode = 'ai';
  role: SessionRole = 'local';
  seatCount = 2;
  aiCount = 1;
  teamFormat: TeamFormat = 'teams';
  seatTeams: number[] = [1, 2];
  prepMode: SwampPrepMode = 'custom';
  raidBoss: RaidBossKind = 'deathknightSpear';
  itemSets: ItemSetSelection = { original: true, finns: false, dlc: false };

  private readonly drafts = Array.from({ length: 4 }, makeDraft);
  private readonly unlockedWords = new Set<WordId>();
  private typed = '';

  get capability(): ModeCapability {
    return MODE_CAPABILITIES[this.mode];
  }

  setMode(mode: MatchMode): void {
    this.mode = mode;
    const capability = this.capability;
    this.role = capability.roles[0];
    this.seatCount = this.clamp(this.seatCount, capability.seats[0], capability.seats[1]);

    if (mode === 'ai') this.aiCount = this.seatCount - 1;
    else this.aiCount = 0;

    if (capability.formats.length === 0) this.teamFormat = 'teams';
    else if (!(capability.formats as readonly TeamFormat[]).includes(this.teamFormat)) {
      this.teamFormat = capability.formats[0];
    }

    if (capability.prepModes.length > 0) {
      if (!(capability.prepModes as readonly SwampPrepMode[]).includes(this.prepMode)) {
        this.prepMode = capability.prepModes[0];
      }
    }

    this.syncSeatTeams();
    this.trimDrafts();
  }

  setRole(role: SessionRole): boolean {
    if (!(this.capability.roles as readonly SessionRole[]).includes(role)) return false;
    this.role = role;
    return true;
  }

  setSeatCount(value: number): void {
    const [minimum, maximum] = this.capability.seats;
    this.seatCount = this.clamp(Math.round(value), minimum, maximum);
    if (this.mode === 'ai') this.aiCount = this.seatCount - 1;
    else this.aiCount = this.clamp(this.aiCount, 0, this.maximumAiCount());
    this.syncSeatTeams();
  }

  setAiCount(value: number): void {
    if (!this.capability.allowAi) {
      this.aiCount = 0;
      return;
    }
    this.aiCount = this.clamp(Math.round(value), 0, this.maximumAiCount());
  }

  setTeamFormat(format: TeamFormat): boolean {
    if (!(this.capability.formats as readonly TeamFormat[]).includes(format)) return false;
    this.teamFormat = format;
    if (format === 'teams') this.syncSeatTeams();
    return true;
  }

  setSeatTeam(seat: number, team: 1 | 2): boolean {
    if (this.teamFormat !== 'teams' || seat < 0 || seat >= this.seatCount) return false;
    const previous = this.seatTeams[seat];
    this.seatTeams[seat] = team;
    const teamOne = this.seatTeams.slice(0, this.seatCount).filter((value) => value === 1).length;
    if (teamOne === 0 || teamOne === this.seatCount) {
      this.seatTeams[seat] = previous;
      return false;
    }
    return true;
  }

  setPrepMode(mode: SwampPrepMode): boolean {
    if (!(this.capability.prepModes as readonly SwampPrepMode[]).includes(mode)) return false;
    this.prepMode = mode;
    return true;
  }

  setRaidBoss(kind: RaidBossKind): boolean {
    if (!RAID_BOSS_KINDS.includes(kind)) return false;
    this.raidBoss = kind;
    return true;
  }

  toggleItemSet(set: keyof ItemSetSelection): boolean {
    const next = { ...this.itemSets, [set]: !this.itemSets[set] };
    if (!next.original && !next.finns && !next.dlc) return false;
    this.itemSets = next;
    return true;
  }

  draftFor(seat: number): MageDraft {
    const index = this.clamp(Math.round(seat), 0, this.drafts.length - 1);
    return this.drafts[index];
  }

  setClass(seat: number, mageClass: MageClass): void {
    this.draftFor(seat).mageClass = mageClass;
  }

  setModifier(seat: number, modifier: WordId): boolean {
    if (!isModifierWord(modifier)) return false;
    this.draftFor(seat).modifier = modifier;
    return true;
  }

  toggleWord(seat: number, word: WordId): boolean {
    if (isModifierWord(word)) return false;
    const draft = this.draftFor(seat);
    const selected = draft.words.indexOf(word);
    if (selected >= 0) {
      draft.words.splice(selected, 1);
      return true;
    }
    if (draft.words.length >= this.loadoutLimit()) return false;
    draft.words.push(word);
    return true;
  }

  feedSecretKey(key: string, seat = 0): SecretPreset | null {
    const letter = key.toUpperCase();
    if (letter.length !== 1 || letter < 'A' || letter > 'Z') return null;
    this.typed = (this.typed + letter).slice(-5);
    const preset = (Object.keys(PRESET_LOADOUTS) as SecretPreset[]).find((name) =>
      this.typed.endsWith(name)
    );
    if (!preset) return null;
    this.applyPreset(preset, seat);
    return preset;
  }

  applyPreset(preset: SecretPreset, seat = 0): void {
    const words = PRESET_LOADOUTS[preset];
    for (const word of words) {
      if (!WORD_ORDER.includes(word)) this.unlockedWords.add(word);
    }
    this.draftFor(seat).words = words.slice(0, this.loadoutLimit());
  }

  visibleWords(): WordId[] {
    return [
      ...WORD_ORDER,
      ...[...this.unlockedWords].filter((word) => !WORD_ORDER.includes(word)),
    ];
  }

  loadoutLimit(): number {
    return this.capability.loadoutSize;
  }

  loadoutReady(seat: number): boolean {
    const words = this.draftFor(seat).words;
    return words.length === this.loadoutLimit() || this.isNadSelection(words);
  }

  missingWords(seat: number): number {
    return Math.max(0, this.loadoutLimit() - this.draftFor(seat).words.length);
  }

  humanCount(): number {
    return Math.max(1, this.seatCount - this.aiCount);
  }

  humanSeats(): number[] {
    return Array.from({ length: this.humanCount() }, (_, index) => index);
  }

  localDraftSeats(): number[] {
    if (this.mode === 'online' || this.role !== 'local' || this.mode === 'training') return [0];
    return this.humanSeats();
  }

  teamOf(seat: number): number {
    if (isPveRunMode(this.mode)) return 1;
    if (this.teamFormat === 'ffa') return seat + 1;
    return this.seatTeams[seat] ?? (seat < Math.ceil(this.seatCount / 2) ? 1 : 2);
  }

  formatLabel(): string {
    if (this.teamFormat === 'ffa') return this.seatCount <= 2 ? 'Duel' : 'Free-for-all';
    const teamOne = Array.from({ length: this.seatCount }, (_, seat) => this.teamOf(seat))
      .filter((team) => team === 1).length;
    return `${Math.max(teamOne, this.seatCount - teamOne)}v${Math.min(teamOne, this.seatCount - teamOne)}`;
  }

  toLocalMatchConfig(random: () => number = Math.random): MatchConfig {
    if (this.mode === 'online' || this.role !== 'local') {
      throw new Error('Online matches are assembled by the lobby coordinator.');
    }
    if (this.mode === 'memory') throw new Error('Memory matches require a loaded scenario.');
    for (const seat of this.localDraftSeats()) {
      if (!this.loadoutReady(seat)) throw new Error(`Player ${seat + 1}'s build is incomplete.`);
    }

    if (this.mode === 'training') {
      const player = this.draftFor(0);
      const opponent = this.randomAiLoadout(random);
      return {
        mode: this.mode,
        loadouts: [this.withModifier(player), opponent],
        classes: [player.mageClass, this.randomClass(random)],
        itemSets: { ...this.itemSets },
      };
    }

    const humanSeats = new Set(this.humanSeats());
    const seats: SeatConfig[] = Array.from({ length: this.seatCount }, (_, seat) => {
      const human = humanSeats.has(seat);
      const draft = this.draftFor(seat);
      return {
        name: human ? `Player ${seat + 1}` : this.seatCount > 2 ? `AI ${seat + 1}` : 'AI',
        team: this.teamOf(seat),
        isAI: !human,
        loadout: human ? this.withModifier(draft) : this.randomAiLoadout(random),
        mageClass: human ? draft.mageClass : this.randomClass(random),
      };
    });

    return {
      mode: this.mode,
      loadouts: [seats[0].loadout, seats[1]?.loadout ?? seats[0].loadout],
      classes: [seats[0].mageClass ?? DEFAULT_MAGE_CLASS, seats[1]?.mageClass ?? DEFAULT_MAGE_CLASS],
      seats,
      itemSets: { ...this.itemSets },
      swampPrepMode: usesSwampPrep(this.mode) ? this.prepMode : undefined,
      raidBoss: this.mode === 'raid' ? this.raidBoss : undefined,
    };
  }

  private maximumAiCount(): number {
    return this.capability.allowAi ? Math.max(0, this.seatCount - 1) : 0;
  }

  private syncSeatTeams(): void {
    const halfway = Math.ceil(this.seatCount / 2);
    this.seatTeams = Array.from({ length: this.seatCount }, (_, seat) => seat < halfway ? 1 : 2);
  }

  private trimDrafts(): void {
    const limit = this.loadoutLimit();
    for (const draft of this.drafts) draft.words = draft.words.slice(0, limit);
  }

  private isNadSelection(words: readonly WordId[]): boolean {
    if (this.mode === 'expedition' || (words.length !== 4 && words.length !== 5)) return false;
    return PRESET_LOADOUTS.NAD.every((word) => words.includes(word));
  }

  private withModifier(draft: MageDraft): WordId[] {
    return [...draft.words.filter((word) => !isModifierWord(word)), draft.modifier];
  }

  private randomAiLoadout(random: () => number): WordId[] {
    const picks = shuffled(WORD_ORDER, random).slice(0, 5);
    if (!picks.some((word) => WORDS[word].grantsReaction)) picks[0] = 'mind';
    const modifier = MODIFIER_WORDS[Math.floor(random() * MODIFIER_WORDS.length)] ?? MODIFIER_WORDS[0];
    return [...picks, modifier];
  }

  private randomClass(random: () => number): MageClass {
    return MAGE_CLASSES[Math.floor(random() * MAGE_CLASSES.length)] ?? DEFAULT_MAGE_CLASS;
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }
}