/**
 * Developer / testing toggles. These are NOT part of normal gameplay — they are
 * a cheat panel (top-right of the field, or F1–F3) used to make manual testing
 * faster. The object is a module singleton so the toggles persist across scene
 * restarts within a session.
 */
export const Dev = {
  /** Spells auto-pass their DC roll and attacks never miss (veil dodge ignored). */
  autoSuccess: false,
  /** Movement range is unlimited and moving never costs a move action. */
  infiniteMove: false,
  /** Move / main / bonus actions never run out, and spells may be cast freely. */
  infiniteActions: false,
  /** The AI takes no turn actions and declines every reaction (it just passes). */
  aiPassive: false,
};

export type DevToggle = keyof typeof Dev;
