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
  const [campaign, tactical, action, page] = await Promise.all([
    source("components/simulation/SimulationCampaign.tsx"),
    source("components/simulation/TacticalArena.tsx"),
    source("components/simulation/ActionArena.tsx"),
    source("app/simulation/page.tsx"),
  ]);

  assert.match(campaign, /lazy\(\(\) => import\("\.\/ActionArena"\)\)/);
  assert.doesNotMatch(campaign, /import Phaser from/);
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

test("campaign invalidates stale async work and hands focus between scenes", async () => {
  const [campaign, client] = await Promise.all([
    source("components/simulation/SimulationCampaign.tsx"),
    source("components/simulation/simulation-client.ts"),
  ]);
  assert.match(campaign, /runEpochRef/);
  assert.match(campaign, /activeRequestsRef/);
  assert.match(campaign, /controller\.abort\(\)/);
  assert.match(campaign, /runEpoch !== runEpochRef\.current/);
  assert.match(campaign, /pendingTurns/);
  assert.match(campaign, /data-simulation-stage/);
  assert.match(campaign, /focus\(\{ preventScroll: true \}\)/);
  assert.match(campaign, /aria-live="polite" aria-atomic="true"/);
  assert.match(client, /signal\?: AbortSignal/);
});

test("no-JavaScript renders the dossier without dead campaign controls", async () => {
  const [page, campaign, copy] = await Promise.all([
    source("app/simulation/page.tsx"),
    source("components/simulation/SimulationCampaign.tsx"),
    source("content/copy/pages/simulation.md"),
  ]);
  assert.match(campaign, /data-simulation-interactive/);
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
  const campaign = await source("components/simulation/SimulationCampaign.tsx");
  assert.match(campaign, /<h3>Three observations<\/h3>/);
  assert.match(campaign, /\.slice\([\s\S]*?0,[\s\S]*?3/);
  assert.match(campaign, /<h3>Two artifacts<\/h3>/);
  assert.match(campaign, /\.slice\([\s\S]*?0,[\s\S]*?2/);
  assert.match(campaign, /<h3>One public doorway<\/h3>/);
  assert.match(campaign, /<h3>A better question<\/h3>/);
  assert.match(campaign, /https:\/\/www\.linkedin\.com\/in\/anish-shah/);
});

test("all campaign audio calls use declared simulation cue slots", async () => {
  const [campaign, audioManifest] = await Promise.all([
    source("components/simulation/SimulationCampaign.tsx"),
    source("content/presentation/experience-audio.v1.json").then(JSON.parse),
  ]);
  const ids = new Set(Object.keys(audioManifest.cues));
  const called = [...campaign.matchAll(/playCue\(\s*["']([^"']+)["']/g)].map(
    ([, id]) => id,
  );
  for (const id of called) assert.ok(ids.has(id), `${id} is not declared`);
});
