/** Deterministic 50ms combat simulation. No data, RNG, wall clock or networking. */
export const TICK_MS = 50;
export const MAX_HEALTH = 100;
export const CHARGE_TICKS = 16;
export const CUSTOM_TICKS = 120;
export const PROGRAMS = [
  "Pulse",
  "Guard",
  "Dash",
  "Sweep",
  "Snare",
  "Repair",
] as const;
export type Program = (typeof PROGRAMS)[number];
export const PROGRAM_INFO = {
  Pulse: {
    code: "A",
    power: "40",
    icon: "→",
    effect: "Fast shot along your row.",
  },
  Guard: {
    code: "*",
    power: "BLOCK",
    icon: "◇",
    effect: "Shield for the next two seconds.",
  },
  Dash: {
    code: "B",
    power: "35",
    icon: "»",
    effect: "Rush your row, then return. Briefly invulnerable.",
  },
  Sweep: {
    code: "B",
    power: "50",
    icon: "╋",
    effect: "Wide blade: two columns ahead, three rows.",
  },
  Snare: {
    code: "A",
    power: "20",
    icon: "⌁",
    effect: "Row shot. Stop a target for two seconds.",
  },
  Repair: {
    code: "*",
    power: "+30",
    icon: "+",
    effect: "Restore thirty health, up to one hundred.",
  },
} as const;
export const ENCOUNTERS = ["tutorial", "crosswire", "glitch"] as const;
export type Encounter = (typeof ENCOUNTERS)[number];
export type Cell = { x: number; y: number };
export type Enemy = Cell & {
  id: number;
  kind: "sentry" | "skater" | "warden";
  health: number;
  maxHealth: number;
  phase: "idle" | "windup" | "recover";
  until: number;
  target: Cell;
  stunnedUntil: number;
  hitUntil: number;
};
export type Projectile = Cell & {
  id: number;
  side: "player" | "enemy";
  damage: number;
  speed: number;
  snare: boolean;
};
export type Effect = Cell & {
  id: number;
  kind: "shot" | "hit" | "guard" | "sweep" | "repair" | "dash";
  until: number;
};
export type Battle = {
  encounter: Encounter;
  player: Cell;
  enemy: Cell;
  enemies: Enemy[];
  health: number;
  integrity: number;
  tick: number;
  readyAt: number;
  moveAt: number;
  shootAt: number;
  invulnerableUntil: number;
  phase: "warning" | "impact";
  danger: Cell[];
  guard: boolean;
  shieldUntil: number;
  snared: number;
  charge: number;
  charging: boolean;
  custom: number;
  queue: Program[];
  projectiles: Projectile[];
  effects: Effect[];
  serial: number;
  outcome: "active" | "won" | "lost" | "skipped";
  event: string;
};
export type BattleAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "step"; ticks?: number }
  | { type: "load"; programs: Program[] }
  | { type: "use" }
  | { type: "charge"; held: boolean }
  | { type: "cancel-charge" }
  | { type: "shoot" }
  | { type: "skip" };
export function compatibleHand(programs: readonly Program[]) {
  if (
    programs.length > 3 ||
    new Set(programs).size !== programs.length ||
    programs.some((p) => !PROGRAMS.includes(p))
  )
    return false;
  return (
    new Set(
      programs.map((p) => PROGRAM_INFO[p].code).filter((code) => code !== "*"),
    ).size <= 1
  );
}
export function startBattle(encounter: Encounter): Battle {
  const enemy = (
    id: number,
    kind: Enemy["kind"],
    x: number,
    y: number,
    health: number,
    until: number,
  ): Enemy => ({
    id,
    kind,
    x,
    y,
    health,
    maxHealth: health,
    phase: "idle",
    until,
    target: { x: 1, y: 1 },
    stunnedUntil: 0,
    hitUntil: 0,
  });
  const enemies =
    encounter === "tutorial"
      ? [enemy(1, "sentry", 4, 1, 90, 28)]
      : encounter === "crosswire"
        ? [enemy(1, "sentry", 5, 0, 70, 24), enemy(2, "skater", 4, 2, 70, 42)]
        : [enemy(1, "warden", 5, 1, 180, 24), enemy(2, "skater", 4, 0, 60, 40)];
  return {
    encounter,
    player: { x: 1, y: 1 },
    enemy: { ...enemies[0] },
    enemies,
    health: MAX_HEALTH,
    integrity: enemies.reduce((n, e) => n + e.health, 0),
    tick: 0,
    readyAt: 0,
    moveAt: 0,
    shootAt: 0,
    invulnerableUntil: 0,
    phase: "warning",
    danger: [],
    guard: false,
    shieldUntil: 0,
    snared: 0,
    charge: 0,
    charging: false,
    custom: CUSTOM_TICKS,
    queue: [],
    projectiles: [],
    effects: [],
    serial: 0,
    outcome: "active",
    event: "Choose your opening chips",
  };
}
function effect(s: Battle, kind: Effect["kind"], cell: Cell) {
  s.effects.push({ ...cell, id: ++s.serial, kind, until: s.tick + 7 });
}
function hitEnemy(s: Battle, enemy: Enemy, damage: number, snare = false) {
  enemy.health = Math.max(0, enemy.health - damage);
  enemy.hitUntil = s.tick + 4;
  if (snare) enemy.stunnedUntil = s.tick + 40;
  effect(s, "hit", enemy);
  s.event = `${damage} damage`;
}
function hurt(s: Battle, damage: number) {
  if (s.invulnerableUntil > s.tick) return;
  if (s.shieldUntil > s.tick) {
    effect(s, "guard", s.player);
    s.event = "Blocked";
    return;
  }
  s.health = Math.max(0, s.health - damage);
  s.invulnerableUntil = s.tick + 12;
  s.charging = false;
  s.charge = 0;
  effect(s, "hit", s.player);
  s.event = "Hit — move off the attack lane";
}
function shoot(s: Battle, damage: number, speed = 0.7, snare = false) {
  s.projectiles.push({
    ...s.player,
    x: s.player.x + 0.5,
    id: ++s.serial,
    side: "player",
    damage,
    speed,
    snare,
  });
  effect(s, "shot", s.player);
}
function dangerCells(e: Enemy): Cell[] {
  return e.kind === "warden"
    ? [0, 1, 2].map((y) => ({ x: e.target.x, y }))
    : [0, 1, 2].map((x) => ({ x, y: e.target.y }));
}
function advance(s: Battle) {
  s.tick++;
  s.custom = Math.min(CUSTOM_TICKS, s.custom + 1);
  if (s.charging) s.charge = Math.min(CHARGE_TICKS, s.charge + 1);
  s.effects = s.effects.filter((e) => e.until > s.tick);
  s.guard = s.shieldUntil > s.tick;
  const liveShots: Projectile[] = [];
  for (const shot of s.projectiles) {
    const previous = shot.x;
    shot.x += shot.side === "player" ? shot.speed : -shot.speed;
    if (shot.side === "player") {
      const target = [...s.enemies]
        .sort((a, b) => a.x - b.x)
        .find(
          (e) =>
            e.health > 0 &&
            e.y === shot.y &&
            e.x >= previous - 0.4 &&
            e.x <= shot.x + 0.4,
        );
      if (target) {
        hitEnemy(s, target, shot.damage, shot.snare);
        continue;
      }
    } else if (
      s.player.y === shot.y &&
      s.player.x <= previous + 0.4 &&
      s.player.x >= shot.x - 0.4
    ) {
      hurt(s, shot.damage);
      continue;
    }
    if (shot.x > -0.5 && shot.x < 6) liveShots.push(shot);
  }
  s.projectiles = liveShots;
  for (const e of s.enemies) {
    if (e.health <= 0 || e.stunnedUntil > s.tick) continue;
    if (e.phase === "idle") {
      if (e.kind === "skater" && s.tick % 10 === 0) {
        const next = (e.y + 1) % 3;
        if (
          !s.enemies.some(
            (other) =>
              other.id !== e.id &&
              other.health > 0 &&
              other.x === e.x &&
              other.y === next,
          )
        )
          e.y = next;
      }
      if (s.tick >= e.until) {
        // Row shooters fire from their actual panel; only the warden targets a column.
        e.target = { ...s.player, y: e.kind === "warden" ? s.player.y : e.y };
        e.phase = "windup";
        e.until = s.tick + (s.encounter === "tutorial" ? 22 : 14);
      }
    } else if (e.phase === "windup" && s.tick >= e.until) {
      if (e.kind === "warden") {
        for (const cell of dangerCells(e)) effect(s, "sweep", cell);
        if (s.player.x === e.target.x) hurt(s, 20);
      } else {
        s.projectiles.push({
          id: ++s.serial,
          side: "enemy",
          x: e.x - 0.4,
          y: e.target.y,
          damage: 15,
          speed: 0.38,
          snare: false,
        });
        effect(s, "shot", { x: e.x, y: e.target.y });
      }
      e.phase = "recover";
      e.until = s.tick + 12;
    } else if (e.phase === "recover" && s.tick >= e.until) {
      e.phase = "idle";
      e.until = s.tick + (s.encounter === "tutorial" ? 26 : 18);
    }
  }
  s.danger = s.enemies
    .filter(
      (e) => e.health > 0 && e.phase === "windup" && e.stunnedUntil <= s.tick,
    )
    .flatMap(dangerCells);
  s.phase = s.danger.length ? "warning" : "impact";
  s.integrity = s.enemies.reduce((n, e) => n + e.health, 0);
  s.enemy = s.enemies.find((e) => e.health > 0) ?? s.enemy;
  if (s.integrity <= 0) {
    s.outcome = "won";
    s.event = "Network restored";
  }
  if (s.health <= 0) {
    s.outcome = "lost";
    s.event = "Connection lost — retry or leave";
  }
}
export function battleStep(previous: Battle, action: BattleAction): Battle {
  if (previous.outcome !== "active") return previous;
  const s = structuredClone(previous);
  if (action.type === "skip")
    return { ...s, outcome: "skipped", charging: false, event: "skipped" };
  if (action.type === "load") {
    if (s.custom < CUSTOM_TICKS || !compatibleHand(action.programs))
      return previous;
    return {
      ...s,
      queue: [...action.programs],
      custom: 0,
      charging: false,
      charge: 0,
      event: "Battle start",
    };
  }
  if (action.type === "move") {
    if (Math.abs(action.dx) + Math.abs(action.dy) !== 1 || s.tick < s.moveAt)
      return previous;
    const x = Math.max(0, Math.min(2, s.player.x + action.dx)),
      y = Math.max(0, Math.min(2, s.player.y + action.dy));
    if (x === s.player.x && y === s.player.y) return previous;
    s.player = { x, y };
    s.moveAt = s.tick + 2;
    s.event = "moved";
  }
  if (action.type === "cancel-charge") {
    s.charging = false;
    s.charge = 0;
  }
  if (action.type === "charge" && action.held) {
    if (!s.charging) s.charge = 0;
    s.charging = true;
  }
  if (action.type === "shoot" || (action.type === "charge" && !action.held)) {
    if (action.type === "charge" && !s.charging) return previous;
    if (s.tick >= s.shootAt) {
      const charged = s.charge >= CHARGE_TICKS;
      shoot(s, charged ? 30 : 8);
      s.shootAt = s.tick + 4;
      s.event = charged ? "Charged shot" : "Blaster";
    }
    s.charging = false;
    s.charge = 0;
  }
  if (action.type === "use") {
    if (s.tick < s.readyAt) return previous;
    const program = s.queue.shift();
    if (!program) return previous;
    s.readyAt = s.tick + 7;
    s.charging = false;
    s.charge = 0;
    s.event = program;
    if (program === "Pulse") shoot(s, 40, 1.1);
    if (program === "Guard") {
      s.shieldUntil = s.tick + 40;
      s.guard = true;
      effect(s, "guard", s.player);
    }
    if (program === "Dash") {
      for (const e of s.enemies)
        if (e.health > 0 && e.y === s.player.y) hitEnemy(s, e, 35);
      s.invulnerableUntil = s.tick + 12;
      effect(s, "dash", s.player);
    }
    if (program === "Sweep") {
      for (const e of s.enemies)
        if (
          e.health > 0 &&
          e.x - s.player.x <= 2 &&
          Math.abs(e.y - s.player.y) <= 1
        )
          hitEnemy(s, e, 50);
      effect(s, "sweep", { x: s.player.x + 1, y: s.player.y });
    }
    if (program === "Snare") shoot(s, 20, 0.8, true);
    if (program === "Repair") {
      s.health = Math.min(MAX_HEALTH, s.health + 30);
      effect(s, "repair", s.player);
    }
    s.integrity = s.enemies.reduce((n, e) => n + e.health, 0);
    if (s.integrity === 0) {
      s.outcome = "won";
      s.event = "Network restored";
    }
  }
  if (action.type === "step")
    for (
      let i = 0;
      i < Math.max(1, Math.min(20, Math.floor(action.ticks ?? 1))) &&
      s.outcome === "active";
      i++
    )
      advance(s);
  return s;
}
