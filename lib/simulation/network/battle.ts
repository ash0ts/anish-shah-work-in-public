/** Fictional mechanics only. This module has no content, storage, network or clock. */
export const PROGRAMS = [
  "Pulse",
  "Guard",
  "Dash",
  "Sweep",
  "Snare",
  "Repair",
] as const;
export type Program = (typeof PROGRAMS)[number];
export const ENCOUNTERS = ["tutorial", "crosswire", "glitch"] as const;
export type Encounter = (typeof ENCOUNTERS)[number];
export type Cell = { x: number; y: number };
export type Battle = {
  encounter: Encounter;
  player: Cell;
  enemy: Cell;
  health: number;
  integrity: number;
  tick: number;
  readyAt: number;
  phase: "warning" | "impact";
  danger: Cell[];
  guard: boolean;
  snared: number;
  queue: Program[];
  outcome: "active" | "won" | "lost" | "skipped";
  event: string;
};
export type BattleAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "step" }
  | { type: "load"; programs: Program[] }
  | { type: "use" }
  | { type: "skip" };
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const warning = (encounter: Encounter, tick: number): Cell[] => {
  const row = Math.floor(tick / 2) % 3;
  return Array.from({ length: 3 }, (_, x) => ({ x, y: row })).concat(
    encounter === "glitch" ? [{ x: (row + 1) % 3, y: (row + 1) % 3 }] : [],
  );
};
export function startBattle(encounter: Encounter): Battle {
  return {
    encounter,
    player: { x: 1, y: 1 },
    enemy: { x: 4, y: 1 },
    health: 12,
    integrity:
      encounter === "tutorial" ? 8 : encounter === "crosswire" ? 14 : 20,
    tick: 0,
    readyAt: 0,
    phase: "warning",
    danger: warning(encounter, 0),
    guard: false,
    snared: 0,
    queue: ["Pulse", "Guard", "Sweep"],
    outcome: "active",
    event: "ready",
  };
}
export function battleStep(previous: Battle, action: BattleAction): Battle {
  if (previous.outcome !== "active") return previous;
  const s = structuredClone(previous);
  if (action.type === "skip")
    return { ...s, outcome: "skipped", event: "skipped" };
  if (action.type === "load")
    return {
      ...s,
      queue: action.programs.filter((p) => PROGRAMS.includes(p)).slice(0, 3),
      event: "loaded",
    };
  if (action.type === "move") {
    if (Math.abs(action.dx) + Math.abs(action.dy) !== 1) return previous;
    s.player = {
      x: Math.max(0, Math.min(2, s.player.x + action.dx)),
      y: Math.max(0, Math.min(2, s.player.y + action.dy)),
    };
    s.event = "moved";
  }
  if (action.type === "use") {
    if (s.tick < s.readyAt) return previous;
    const program = s.queue.shift();
    if (!program) return previous;
    s.readyAt = s.tick + 1;
    s.event = program;
    if (program === "Pulse" && s.player.y === s.enemy.y) s.integrity -= 4;
    if (program === "Guard") s.guard = true;
    if (program === "Dash") {
      s.player.x = s.player.x === 2 ? 0 : 2;
      s.guard = true;
    }
    if (program === "Sweep") s.integrity -= 2;
    if (program === "Snare") {
      s.snared = 3;
      s.integrity -= 1;
    }
    if (program === "Repair") s.health = Math.min(12, s.health + 4);
    if (s.integrity <= 0) return { ...s, integrity: 0, outcome: "won" };
  }
  if (action.type === "step") {
    s.tick++;
    if (s.phase === "warning") {
      if (s.danger.some((cell) => same(cell, s.player))) {
        s.health = Math.max(0, s.health - (s.guard ? 0 : 2));
        s.event = s.guard ? "blocked" : "hit";
        s.guard = false;
      } else s.event = "evaded";
      s.phase = "impact";
      if (s.health === 0) s.outcome = "lost";
    } else {
      if (s.snared > 0) s.snared--;
      else if (s.encounter !== "tutorial") s.enemy.y = (s.enemy.y + 1) % 3;
      s.phase = "warning";
      s.danger = warning(s.encounter, s.tick);
      s.event = "warning";
    }
  }
  return s;
}
