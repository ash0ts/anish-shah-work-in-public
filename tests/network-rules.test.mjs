import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { createActor } from "xstate";
const { PROGRAMS, ENCOUNTERS, startBattle, battleStep } = await tsImport(
  "../lib/simulation/network/battle.ts",
  import.meta.url,
);
const { networkMachine } = await tsImport(
  "../lib/simulation/network/machine.ts",
  import.meta.url,
);
const { readProgress, progressSchema } = await tsImport(
  "../lib/simulation/network/progress.ts",
  import.meta.url,
);
const { catalogQuery, pageCatalog } = await tsImport(
  "../lib/simulation/network/catalog-contract.ts",
  import.meta.url,
);
test("turn visibility removes hidden Work, replaced collection chips and grounded transcript together", async () => {
  const { visibleDiscoveries, visibleExchanges } = await tsImport(
    "../lib/simulation/network/visibility.ts",
    import.meta.url,
  );
  const visible = new Set(["group:current", "saved:spotify:new"]);
  const items = [
    "group:hidden",
    "group:current",
    "saved:spotify:old",
    "saved:spotify:new",
  ].map((id) => ({ id }));
  assert.deepEqual(
    visibleDiscoveries(items, visible).map((item) => item.id),
    [...visible],
  );
  assert.deepEqual(
    visibleExchanges(
      [
        { sourceIds: ["group:hidden"] },
        { sourceIds: ["group:current", "saved:spotify:old"] },
        { sourceIds: ["group:current"] },
      ],
      visible,
    ),
    [{ sourceIds: ["group:current"] }],
  );
  assert.deepEqual(visibleDiscoveries(items, new Set()), []);
});
const advance = (s, ticks) => {
  for (let i = 0; i < ticks; i++) s = battleStep(s, { type: "step" });
  return s;
};
test("all six chips have distinct effects, collision and range; real measurements never enter combat", () => {
  const initial = startBattle("tutorial");
  const use = (p, s = initial) =>
    battleStep(battleStep(s, { type: "load", programs: [p] }), { type: "use" });
  assert.equal(use("Pulse").integrity, 90, "shots travel before impact");
  assert.equal(advance(use("Pulse"), 5).integrity, 50);
  assert(use("Guard").guard);
  assert.equal(use("Dash").integrity, 55);
  assert.equal(use("Sweep").integrity, 90, "blade cannot reach from the back");
  assert.equal(
    use("Sweep", { ...initial, player: { x: 2, y: 1 } }).integrity,
    40,
  );
  const snared = advance(use("Snare"), 5);
  assert.equal(snared.integrity, 70);
  assert(snared.enemies[0].stunnedUntil > snared.tick);
  assert.equal(use("Repair", { ...initial, health: 40 }).health, 70);
  assert.equal(initial.integrity, 90, "inputs remain immutable");
});
test("a basic blaster always works; charge, cooldown, cancellation and off-row misses are real", () => {
  let b = startBattle("tutorial");
  b = battleStep(b, { type: "shoot" });
  assert.equal(b.projectiles.length, 1);
  assert.equal(battleStep(b, { type: "shoot" }).projectiles.length, 1);
  assert.equal(advance(b, 5).integrity, 82);
  b = advance(
    battleStep(startBattle("tutorial"), { type: "charge", held: true }),
    16,
  );
  assert.equal(
    advance(battleStep(b, { type: "charge", held: false }), 5).integrity,
    60,
  );
  assert.equal(battleStep(b, { type: "cancel-charge" }).charge, 0);
  const cancelled = battleStep(b, { type: "cancel-charge" });
  assert.deepEqual(
    battleStep(cancelled, { type: "charge", held: false }),
    cancelled,
    "cancelled pointers or keys must not fire on release",
  );
  const miss = battleStep(
    { ...startBattle("tutorial"), player: { x: 1, y: 0 } },
    { type: "shoot" },
  );
  assert.equal(advance(miss, 10).integrity, 90);
});
test("chip selection pauses on entry, validates code compatibility and waits six active seconds to refill", async () => {
  const { compatibleHand, CUSTOM_TICKS } = await tsImport(
    "../lib/simulation/network/battle.ts",
    import.meta.url,
  );
  assert(compatibleHand(["Pulse", "Snare", "Guard"]));
  assert(compatibleHand(["Dash", "Sweep", "Repair"]));
  assert(!compatibleHand(["Pulse", "Sweep"]));
  assert(!compatibleHand(["Pulse", "Pulse"]));
  const actor = createActor(networkMachine).start();
  actor.send({ type: "ENCOUNTER", encounter: "tutorial" });
  assert.equal(actor.getSnapshot().value, "custom");
  actor.send({ type: "BATTLE", action: { type: "step" } });
  assert.equal(actor.getSnapshot().context.battle.tick, 0);
  actor.send({
    type: "BATTLE",
    action: { type: "load", programs: ["Pulse", "Guard"] },
  });
  actor.send({ type: "CLOSE" });
  actor.send({ type: "CUSTOM" });
  assert.equal(actor.getSnapshot().value, "battling");
  for (let i = 0; i < CUSTOM_TICKS; i++)
    actor.send({ type: "BATTLE", action: { type: "step" } });
  actor.send({ type: "CUSTOM" });
  assert.equal(actor.getSnapshot().value, "custom");
  const frozen = actor.getSnapshot().context.battle;
  actor.send({ type: "BATTLE", action: { type: "step" } });
  assert.deepEqual(actor.getSnapshot().context.battle, frozen);
  actor.send({ type: "EXIT_BATTLE" });
  assert.equal(actor.getSnapshot().context.battle, null);
  actor.stop();
});
test("telegraphed attacks lock their target; dodging changes outcomes and hits grant recovery time", () => {
  let warned = advance(startBattle("tutorial"), 28);
  assert.equal(warned.enemies[0].phase, "windup");
  assert(warned.danger.some((c) => c.y === 1));
  const hit = advance(warned, 35);
  assert.equal(hit.health, 85);
  const dodged = advance(
    battleStep(warned, { type: "move", dx: 0, dy: -1 }),
    35,
  );
  assert.equal(dodged.health, 100);
  assert.equal(
    dodged.enemies[0].target.y,
    1,
    "aim cannot silently track the dodge",
  );
  const offRow = advance(
    { ...startBattle("tutorial"), player: { x: 1, y: 0 } },
    28,
  );
  assert.equal(
    offRow.enemies[0].target.y,
    1,
    "row attacks originate at the enemy, not an invisible panel",
  );
});
test("all encounters are deterministic, have distinct enemy patterns, and can be won without chips", () => {
  for (const encounter of ENCOUNTERS) {
    const run = () => {
      let b = battleStep(startBattle(encounter), {
        type: "load",
        programs: [],
      });
      for (let i = 0; i < 3000 && b.outcome === "active"; i++) {
        const threatened = (cell) =>
          b.danger.some((d) => d.x === cell.x && d.y === cell.y) ||
          b.projectiles.some(
            (p) =>
              p.side === "enemy" &&
              p.y === cell.y &&
              Math.abs(p.x - cell.x) < 1.5,
          );
        const target = b.enemies.find((e) => e.health > 0);
        if (threatened(b.player)) {
          const safe = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ].find(([dx, dy]) => {
            const c = { x: b.player.x + dx, y: b.player.y + dy };
            return c.x >= 0 && c.x < 3 && c.y >= 0 && c.y < 3 && !threatened(c);
          });
          if (safe)
            b = battleStep(b, { type: "move", dx: safe[0], dy: safe[1] });
        } else if (target.y !== b.player.y) {
          const dy = Math.sign(target.y - b.player.y);
          if (!threatened({ x: b.player.x, y: b.player.y + dy }))
            b = battleStep(b, { type: "move", dx: 0, dy });
        }
        b = battleStep(b, { type: "shoot" });
        b = battleStep(b, { type: "step" });
      }
      return b;
    };
    const b = run();
    assert.deepEqual(b, run());
    assert.equal(b.outcome, "won", encounter);
    assert(b.tick < 3000);
    assert.deepEqual(battleStep(b, { type: "step" }), b);
    assert.equal(
      battleStep(startBattle(encounter), { type: "skip" }).outcome,
      "skipped",
    );
  }
});
test("movement is bounded and throttled; inventory and pause cancel charging without losing discoveries", () => {
  const actor = createActor(networkMachine).start();
  actor.send({ type: "WALK", x: 999, y: -20 });
  assert.deepEqual(actor.getSnapshot().context.position, { x: 8, y: 0 });
  actor.send({ type: "INSPECT", id: "group:example" });
  actor.send({ type: "ENCOUNTER", encounter: "tutorial" });
  actor.send({ type: "CLOSE" });
  actor.send({ type: "BATTLE", action: { type: "charge", held: true } });
  actor.send({ type: "FOLDER" });
  const before = actor.getSnapshot().context.battle;
  assert.equal(before.charging, false);
  actor.send({ type: "BATTLE", action: { type: "step" } });
  assert.deepEqual(actor.getSnapshot().context.battle, before);
  actor.send({ type: "EXIT_BATTLE" });
  assert.deepEqual(actor.getSnapshot().context.discoveries, ["group:example"]);
  actor.stop();
});
test("device progress is strict, bounded, ID-only and revalidated", () => {
  const value = {
    version: 1,
    discoveries: ["group:visible", "group:hidden"],
    equipped: PROGRAMS.map((program) => ({
      program,
      discoveryId: "group:hidden",
    })),
    completed: ["tutorial"],
    stepMode: true,
    sound: false,
  };
  const saved = readProgress(JSON.stringify(value), new Set(["group:visible"]));
  assert.deepEqual(saved.discoveries, ["group:visible"]);
  assert(saved.equipped.every((s) => s.discoveryId === null));
  assert(!progressSchema.safeParse({ ...value, transcript: "no" }).success);
  assert.equal(readProgress("invalid", new Set()), null);
  assert.equal(readProgress("x".repeat(13000), new Set()), null);
});
test("catalog query is closed and bounded and pages contain at most 24 records", () => {
  const url = (q) =>
    new URL(`https://example.test/api/simulation/catalog?${q}`);
  for (const q of [
    "domain=strava",
    "domain=travel",
    "q=" + "a".repeat(81),
    "page=0",
    "page=1e9",
    "secret=x",
  ])
    assert.equal(catalogQuery(url(q)), null);
  assert.deepEqual(catalogQuery(url("domain=steam&page=2&q=portal")), {
    domain: "steam",
    page: 2,
    q: "portal",
  });
  const rows = Array.from({ length: 49 }, (_, i) => ({
    id: String(i),
    title: `Title ${i}`,
    text: "",
  }));
  assert.equal(pageCatalog(rows, "work", "", 1).items.length, 24);
  assert.equal(pageCatalog(rows, "work", "", 3).items.length, 1);
});

test("saved collection progress is revalidated across pages without copying its data into storage", async () => {
  const { restoreDeviceProgress } = await tsImport(
    "../components/simulation/network/restore-progress.ts",
    import.meta.url,
  );
  const saved = {
    version: 1,
    discoveries: ["fixture:spotify:25", "fixture:spotify:999"],
    equipped: PROGRAMS.map((program) => ({
      program,
      discoveryId: "fixture:spotify:25",
    })),
    completed: [],
    stepMode: true,
    sound: false,
  };
  const restored = await restoreDeviceProgress(
    JSON.stringify(saved),
    [],
    [],
    true,
    AbortSignal.timeout(1000),
  );
  assert.deepEqual(restored.saved.discoveries, ["fixture:spotify:25"]);
  assert(restored.items.some((item) => item.id === "fixture:spotify:25"));
  assert(!JSON.stringify(restored.saved).includes("Invented"));
  for (const q of [
    "ids=bad",
    "ids=" + Array(25).fill("group:test").join(","),
    "domain=work&domain=steam",
  ])
    assert.equal(catalogQuery(new URL(`https://example.test/?${q}`)), null);
  assert.deepEqual(
    catalogQuery(new URL("https://example.test/?ids=group:test")),
    { domain: "work", q: "", page: 1, ids: ["group:test"] },
  );
});
