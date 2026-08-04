import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const source = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const manifest = JSON.parse(
  await source("content/presentation/simulation.v1.json"),
);
const publicBundle = JSON.parse(
  await source("content/public/anish-content.public.v1.json"),
);

test("campaign facts resolve to public work and evidence records", () => {
  const groups = new Set(publicBundle.workGroups.map(({ id }) => id));
  const evidence = new Map(
    publicBundle.evidence.map((entry) => [entry.id, entry]),
  );

  assert.equal(manifest.facts.length, 12);
  for (const fact of manifest.facts) {
    assert.ok(
      fact.subjectIds.some((id) => groups.has(id)),
      `${fact.id} has no public WorkGroup`,
    );
    assert.ok(fact.publicEvidenceIds.length > 0, `${fact.id} has no evidence`);
    for (const evidenceId of fact.publicEvidenceIds) {
      assert.equal(
        evidence.get(evidenceId)?.access,
        "public_web",
        `${evidenceId} is not public web evidence`,
      );
    }
  }
});

test("campaign exposes exactly two optional bounded visitor-text moments", () => {
  assert.deepEqual(
    manifest.scenes
      .filter(({ allowsFreeText }) => allowsFreeText)
      .map(({ id }) => id),
    ["act-2", "act-3"],
  );
  assert.deepEqual(
    manifest.scenes.map(({ id }) => id),
    ["act-1", "act-2", "act-3", "boss"],
  );
});

test("Tactical has a complete textual state and cannot import Phaser", async () => {
  const [campaign, bridge, tactical, action, page] = await Promise.all([
    source("components/simulation/SimulationCampaign.tsx"),
    source("components/simulation/campaign/ActionBridge.tsx"),
    source("components/simulation/TacticalArena.tsx"),
    source("components/simulation/ActionArena.tsx"),
    source("app/simulation/page.tsx"),
  ]);

  assert.doesNotMatch(campaign, /ActionArena|Phaser|phaser/);
  assert.doesNotMatch(bridge, /import Phaser from/);
  assert.doesNotMatch(tactical, /phaser/i);
  assert.match(tactical, /role="img"/);
  assert.match(tactical, /aria-label=\{`Five by five evidence field/);
  assert.doesNotMatch(tactical, /role="gridcell"/);
  assert.match(tactical, /aria-live="polite"/);
  assert.match(action, /import Phaser from "phaser"/);
  assert.match(action, /width: 480/);
  assert.match(action, /height: 270/);
  assert.doesNotMatch(page, /ActionArena|phaser/i);
});

test("campaign machine preserves progression, scores, async turns, and reset", async () => {
  const [{ createActor }, { campaignMachine, campaignSceneId, campaignStageKind }] =
    await Promise.all([
      import("xstate"),
      import("../components/simulation/campaign/campaign-state.ts"),
    ]);
  const dossier = {
    ...manifest,
    contentVersion: "test-content",
    generatedAt: "2026-08-04T00:00:00.000Z",
    publicationSource: "published_snapshot",
    facts: manifest.facts.map((fact) => ({
      ...fact,
      title: fact.id,
      qualifier: fact.qualifier ?? null,
      href: fact.href ?? null,
      bucket: "test",
      roleSummary: "test",
    })),
    metrics: [],
    providerDoorways: [
      { provider: "hardcover", label: "Read", route: "/play/read" },
    ],
  };
  const actor = createActor(campaignMachine, { input: { dossier } }).start();
  assert.equal(actor.getSnapshot().value, "boot");
  actor.send({
    type: "START",
    mode: "tactical",
    difficulty: "expert",
    curiosity: "research",
  });
  assert.equal(actor.getSnapshot().value, "act1Wave");
  assert.equal(campaignSceneId("act1Wave"), "act-1");
  assert.equal(campaignStageKind("act1Wave"), "wave");
  actor.send({
    type: "WAVE_COMPLETE",
    progress: {
      context: 1,
      signalsFound: 3,
      elapsedSeconds: 20,
      recalibrations: 1,
    },
  });
  assert.equal(actor.getSnapshot().value, "act1Debrief");
  assert.equal(actor.getSnapshot().context.scores.signalFound, 3);
  assert.equal(actor.getSnapshot().context.recalibrations, 1);
  actor.send({ type: "TURN_REQUESTED" });
  assert.equal(actor.getSnapshot().context.pendingTurns, 1);
  actor.send({
    type: "TURN_RESOLVED",
    response: {
      revision: 1,
      source: "fixture",
      opponent: {
        opponentLine: "A grounded response.",
        responseMode: "counter",
        revealEntityIds: ["group:test"],
        visitorSignals: ["evaluation-rigor"],
      },
      factCards: [
        {
          id: "fact:test",
          statement: "A public statement.",
          qualifier: null,
          href: "/work/test",
          evidenceIds: ["evidence:test"],
        },
      ],
      nextActions: [],
    },
  });
  assert.equal(actor.getSnapshot().context.pendingTurns, 0);
  assert.equal(actor.getSnapshot().context.scores.claimsGrounded, 1);
  assert.deepEqual(actor.getSnapshot().context.revealedFactIds, ["fact:test"]);
  actor.send({ type: "ADVANCE", sceneId: "act-1", actionId: "trace-the-system" });
  assert.equal(actor.getSnapshot().value, "act2Wave");
  actor.send({ type: "RESET" });
  assert.equal(actor.getSnapshot().value, "boot");
  assert.deepEqual(actor.getSnapshot().context.scores, {
    signalFound: 0,
    claimsGrounded: 0,
    curiosityFollowed: 0,
  });
  actor.stop();
});

test("capability selection keeps constrained visitors in Tactical", async () => {
  const { recommendedSimulationMode } = await import(
    "../components/simulation/campaign/campaign-capabilities.ts"
  );
  const capable = {
    reducedMotion: false,
    forcedColors: false,
    zoomScale: 1,
    saveData: false,
    canvasAvailable: true,
    viewportWidth: 1440,
  };
  assert.equal(recommendedSimulationMode(capable), "action");
  for (const constrained of [
    { ...capable, reducedMotion: true },
    { ...capable, forcedColors: true },
    { ...capable, zoomScale: 1.5 },
    { ...capable, saveData: true },
    { ...capable, canvasAvailable: false },
    { ...capable, viewportWidth: 759 },
  ]) {
    assert.equal(recommendedSimulationMode(constrained), "tactical");
  }
});

test("no-JavaScript renders the dossier without dead campaign controls", async () => {
  const [page, copy] = await Promise.all([
    source("app/simulation/page.tsx"),
    source("content/copy/pages/simulation.md"),
  ]);
  assert.match(page, /\[data-simulation-interactive\] \{ display: none !important; \}/);
  assert.match(page, /SITE_COPY\.simulation\["noscript-summary"\]/);
  assert.match(copy, /complete inspectable source deck remains available below/u);
});

test("both gameplay modes use authored pacing and easier recalibration", async () => {
  const [action, tactical] = await Promise.all([
    source("components/simulation/ActionArena.tsx"),
    source("components/simulation/TacticalArena.tsx"),
  ]);
  assert.match(action, /return 100/);
  assert.match(action, /minimumDurationFor/);
  assert.match(action, /this\.pressure = Math\.max\(0\.48, this\.pressure \* 0\.72\)/);
  assert.match(tactical, /minimumTurnsFor/);
  assert.match(tactical, /return 20/);
  assert.match(tactical, /setHazardRelief/);
});

test("disabled Simulation is server-gated and leaves no public shell", async () => {
  const page = await source("app/simulation/page.tsx");
  assert.match(page, /if \(!simulationExperienceEnabled\(\)\) notFound\(\)/);
  assert.match(page, /if \(dossier\.scenes\.length !== 4 \|\| dossier\.facts\.length < 8\) notFound\(\)/);
});

test("authored fallback remains a complete four-beat path", async () => {
  const { authoredSimulationFallback } = await import(
    "../components/simulation/simulation-client.ts"
  );
  const dossier = {
    scenes: manifest.scenes,
    facts: manifest.facts.map((fact) => ({
      ...fact,
      title: fact.id,
      qualifier: fact.qualifier ?? null,
      href: fact.href ?? null,
      bucket: "test",
      roleSummary: "test",
    })),
    fallbackDialogue: manifest.fallbackDialogue,
  };
  const turns = [
    ["act-1", "trace-the-system"],
    ["act-2", "qualify"],
    ["act-3", "read"],
    ["boss", "connect-the-facets"],
  ];

  let revision = 0;
  for (const [sceneId, actionId] of turns) {
    const response = authoredSimulationFallback(
      dossier,
      sceneId,
      actionId,
      revision,
    );
    assert.equal(response.source, "authored_fallback");
    assert.equal(response.revision, revision + 1);
    assert.ok(response.opponent.opponentLine.length > 0);
    revision = response.revision;
  }
  assert.equal(revision, 4);
});

test("sessionStorage projection contains safe progress only", async () => {
  const { safeSimulationProgress } = await import(
    "../components/simulation/simulation-progress.ts"
  );
  const projected = safeSimulationProgress({
    campaignVersion: "meet-me-4n1sh-v1",
    stateName: "act2Wave",
    mode: "tactical",
    difficulty: "standard",
    curiosity: "research",
    revision: 1,
    revealedFactIds: ["fact:work:evalforge"],
    visitorSignals: ["evaluation-rigor"],
    selectedDoorway: null,
    scores: { signalFound: 3, claimsGrounded: 1, curiosityFollowed: 2 },
    recalibrations: 0,
  });
  assert.deepEqual(Object.keys(projected).sort(), [
    "campaignVersion",
    "curiosity",
    "difficulty",
    "mode",
    "recalibrations",
    "revealedFactIds",
    "revision",
    "scores",
    "selectedDoorway",
    "stateName",
    "visitorSignals",
  ]);
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /freeText|opponentLine|prompt|response|message/i);
});

test("Conversation Key has the exact deterministic handoff contract", async () => {
  const { buildConversationKey } = await import(
    "../components/simulation/campaign/conversation-key.ts"
  );
  const facts = [1, 2, 3, 4].map((index) => ({
    id: `fact:${index}`,
    subjectIds: [`group:${index}`],
    title: `Fact ${index}`,
    allowedStatement: `Statement ${index}`,
    qualifier: null,
    publicEvidenceIds: [`evidence:${index}`],
    href: `/work/fact-${index}`,
    bucket: "test",
    roleSummary: "test",
  }));
  const key = buildConversationKey({
    dossier: {
      schemaVersion: "1.0",
      campaignVersion: "test",
      contentVersion: "test",
      generatedAt: "2026-08-04T00:00:00.000Z",
      publicationSource: "published_snapshot",
      persona: manifest.persona,
      facts,
      metrics: [],
      scenes: [],
      providerDoorways: [
        { provider: "hardcover", label: "Read", route: "/play/read" },
      ],
      fallbackDialogue: [],
    },
    mode: "tactical",
    difficulty: "standard",
    curiosity: "research",
    revision: 4,
    pendingTurns: 0,
    lastOpponent: null,
    responseSource: null,
    revealedFactIds: ["fact:2", "fact:3", "fact:4"],
    visitorSignals: [],
    selectedDoorway: "read",
    scores: { signalFound: 4, claimsGrounded: 3, curiosityFollowed: 2 },
    recalibrations: 0,
  });
  assert.deepEqual(key.observations.map(({ id }) => id), [
    "fact:2",
    "fact:3",
    "fact:4",
  ]);
  assert.deepEqual(key.workLinks.map(({ id }) => id), ["fact:2", "fact:3"]);
  assert.equal(key.doorway?.route, "/play/read");
  assert.equal(
    key.question,
    "Which claims survive contact with inspectable evidence?",
  );
});

test("all campaign audio calls use declared simulation cue slots", async () => {
  const [audio, audioManifest] = await Promise.all([
    import(
      "../components/simulation/campaign/campaign-audio.ts"
    ),
    source("content/presentation/experience-audio.v1.json").then(JSON.parse),
  ]);
  const ids = new Set(Object.keys(audioManifest.cues));
  const called = [
    "boot",
    "act1Wave",
    "act2Wave",
    "act3Wave",
    "bossWave",
    "ending",
  ].map(audio.campaignAudioCueForState);
  called.push(
    ...["hit", "evidence", "near-miss", "recalibrate"].map(
      audio.arenaFeedbackAudioCue,
    ),
  );
  for (const id of called) assert.ok(ids.has(id), `${id} is not declared`);
});
