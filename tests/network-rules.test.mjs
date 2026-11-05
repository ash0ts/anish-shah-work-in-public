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
test("every authored program has a distinct deterministic effect; measurements never enter rules", () => {
  const initial = startBattle("tutorial");
  const use = (program) =>
    battleStep(battleStep(initial, { type: "load", programs: [program] }), {
      type: "use",
    });
  assert.equal(use("Pulse").integrity, 4);
  assert(use("Guard").guard);
  assert.equal(use("Dash").player.x, 2);
  assert.equal(use("Sweep").integrity, 6);
  assert.equal(use("Snare").snared, 3);
  const hurt = { ...initial, health: 3, queue: ["Repair"] };
  assert.equal(battleStep(hurt, { type: "use" }).health, 7);
  assert.equal(initial.integrity, 8, "inputs are immutable");
});
test("all three encounters replay identically, telegraph before damage, and allow immediate retry/skip", () => {
  for (const encounter of ENCOUNTERS) {
    const original = startBattle(encounter);
    assert.equal(original.phase, "warning");
    assert.equal(original.danger.length, encounter === "glitch" ? 4 : 3);
    const actions = [
      { type: "move", dx: 0, dy: -1 },
      { type: "step" },
      { type: "load", programs: ["Guard", "Repair", "Sweep", "Pulse"] },
      { type: "use" },
      { type: "step" },
    ];
    const run = () => actions.reduce(battleStep, startBattle(encounter));
    assert.deepEqual(run(), run());
    assert.equal(run().queue.length, 2);
    assert.equal(battleStep(original, { type: "skip" }).outcome, "skipped");
    assert.deepEqual(startBattle(encounter), original);
    let won = original;
    for (let i = 0; i < 30 && won.outcome === "active"; i++) {
      won = battleStep(battleStep(won, { type: "load", programs: ["Sweep"] }), {
        type: "use",
      });
      won = battleStep(won, { type: "step" });
    }
    assert.equal(won.outcome, "won");
    assert.deepEqual(battleStep(won, { type: "step" }), won);
  }
});
test("world and battle bounds, paused inventory, dialogue, retry and journal stay in the state machine", () => {
  const actor = createActor(networkMachine).start();
  actor.send({ type: "WALK", x: 999, y: -20 });
  assert.deepEqual(actor.getSnapshot().context.position, { x: 8, y: 0 });
  actor.send({ type: "INSPECT", id: "group:example" });
  actor.send({ type: "ENCOUNTER", encounter: "tutorial" });
  actor.send({ type: "FOLDER" });
  const before = actor.getSnapshot().context.battle;
  actor.send({ type: "WALK", x: 2, y: 3 });
  assert.deepEqual(actor.getSnapshot().context.battle, before);
  actor.send({ type: "BATTLE", action: { type: "step" } });
  assert.deepEqual(
    actor.getSnapshot().context.battle,
    before,
    "folder pauses the shared clock",
  );
  actor.send({ type: "CHAT" });
  actor.send({ type: "CLOSE" });
  assert.equal(actor.getSnapshot().value, "battling");
  actor.send({ type: "BATTLE", action: { type: "skip" } });
  actor.send({ type: "PAUSE" });
  actor.send({ type: "CLOSE" });
  assert.equal(actor.getSnapshot().value, "exploring");
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
