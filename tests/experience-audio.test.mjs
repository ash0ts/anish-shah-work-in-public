import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  canonicalExperienceAudioManifest,
  experienceAudioManifestHash,
  REQUIRED_EXPERIENCE_AUDIO_CUES,
  validateExperienceAudioManifest,
} from "../scripts/lib/experience-audio-contract.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);
const source = (relativePath) =>
  readFile(new URL(relativePath, repositoryRoot), "utf8");

test("audio startup has a deterministic bounded fallback", async () => {
  const {
    ExperienceAudioStartTimeoutError,
    startAudioWithinDeadline,
  } = await import(
    "../components/experience-audio/audio-start.ts"
  );

  let deadline = null;
  let cancelledHandle = null;
  const pending = startAudioWithinDeadline(
    () => new Promise(() => {}),
    {
      cancel: (handle) => {
        cancelledHandle = handle;
      },
      schedule: (callback) => {
        deadline = callback;
        return 17;
      },
      timeoutMs: 25,
    },
  );
  assert.equal(typeof deadline, "function");
  deadline();
  await assert.rejects(pending, ExperienceAudioStartTimeoutError);
  assert.equal(cancelledHandle, 17);

  let successTimerCancelled = false;
  await startAudioWithinDeadline(() => Promise.resolve(), {
    cancel: () => {
      successTimerCancelled = true;
    },
    schedule: () => 18,
  });
  assert.equal(successTimerCancelled, true);
});

test("the experience audio manifest is strict, quiet, and deterministic", async () => {
  const manifest = JSON.parse(
    await source("content/presentation/experience-audio.v1.json"),
  );
  assert.deepEqual(validateExperienceAudioManifest(manifest), []);
  assert.equal(manifest.masterGainDb, -18);
  assert.equal(manifest.externalMediaDuckDb, -42);
  assert.ok(
    Object.keys(manifest.cues).length >= REQUIRED_EXPERIENCE_AUDIO_CUES.length,
  );
  assert.deepEqual(
    REQUIRED_EXPERIENCE_AUDIO_CUES.filter(
      (cueId) => !Object.hasOwn(manifest.cues, cueId),
    ),
    [],
  );
  assert.doesNotMatch(JSON.stringify(manifest), /https?:|provider|account|token/i);

  const first = experienceAudioManifestHash(manifest);
  const reordered = {
    ...manifest,
    cues: Object.fromEntries(Object.entries(manifest.cues).reverse()),
  };
  assert.equal(experienceAudioManifestHash(reordered), first);
  assert.deepEqual(
    canonicalExperienceAudioManifest(reordered),
    canonicalExperienceAudioManifest(manifest),
  );
});

test("experience audio validation rejects unsafe and unknown data", async () => {
  const manifest = JSON.parse(
    await source("content/presentation/experience-audio.v1.json"),
  );
  assert.match(
    validateExperienceAudioManifest({ ...manifest, remoteUrl: "https://x" }).join(
      "\n",
    ),
    /root fields/,
  );
  const unsafe = structuredClone(manifest);
  unsafe.cues["sound-on"].events[0].velocity = 1;
  assert.match(validateExperienceAudioManifest(unsafe).join("\n"), /unsafe velocity/);
  const malformed = structuredClone(manifest);
  malformed.cues["sound-on"].events[0].note = "not-a-note";
  assert.match(validateExperienceAudioManifest(malformed).join("\n"), /invalid note/);
  const unknownVoice = structuredClone(manifest);
  unknownVoice.cues["sound-on"].events[0].voice = "sample";
  assert.match(
    validateExperienceAudioManifest(unknownVoice).join("\n"),
    /unknown voice/,
  );
  const missingSlot = structuredClone(manifest);
  delete missingSlot.cues["simulation-ending"];
  assert.match(
    validateExperienceAudioManifest(missingSlot).join("\n"),
    /Required cue simulation-ending is missing/,
  );
  const unsafeDuck = structuredClone(manifest);
  unsafeDuck.externalMediaDuckDb = -19;
  assert.match(
    validateExperienceAudioManifest(unsafeDuck).join("\n"),
    /externalMediaDuckDb/,
  );
});

test("the audio build emits one canonical, content-addressed manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anish-experience-audio-"));
  try {
    await execFileAsync(
      process.execPath,
      ["scripts/build-experience-audio.mjs", directory],
      { cwd: repositoryRoot },
    );
    const built = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    const { contentHash, ...manifest } = built;
    assert.deepEqual(validateExperienceAudioManifest(manifest), []);
    assert.equal(contentHash, experienceAudioManifestHash(manifest));
    assert.match(contentHash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Tone remains behind explicit consent and outside non-experience routes", async () => {
  const [provider, layout] = await Promise.all([
    source("components/experience-audio/ExperienceAudioProvider.tsx"),
    source("app/layout.tsx"),
  ]);
  assert.doesNotMatch(provider, /^import .* from ["']tone["'];?$/m);
  assert.match(provider, /await import\("tone"\)/);
  assert.match(provider, /startAudioWithinDeadline\(\(\) => imported\.start\(\)\)/);
  assert.match(provider, /onClick=\{\(\) => void setEnabled\(status !== "on"\)\}/);
  assert.match(provider, /pathname === "\/play"/);
  assert.match(provider, /pathname === "\/simulation"/);
  assert.match(provider, /disposeRuntime\(runtime\.current\)/);
  assert.match(provider, /embeddedControlCount === 0/);
  assert.match(provider, /data-experience-audio-placement=\{placement\}/);
  assert.match(layout, /<ExperienceAudioProvider>/);
  assert.doesNotMatch(
    provider,
    /localStorage|sessionStorage|autoplay|new\s+(?:window\.)?AudioContext/,
  );
});

test("official Spotify players duck and restore the shared experience bus", async () => {
  const [provider, rankedGroove, fallback, player] = await Promise.all([
    source("components/experience-audio/ExperienceAudioProvider.tsx"),
    source("components/spotify/SpotifyRankedGroove.tsx"),
    source("components/spotify/SpotifyFallback.tsx"),
    source("components/spotify/SpotifyTrackPresentation.tsx"),
  ]);
  assert.match(provider, /type ExternalMediaSource = "spotify"/);
  assert.match(provider, /externalMediaDuckDb/);
  assert.match(provider, /master\.gain\.rampTo\(/);
  assert.match(provider, /useExperienceAudioHandoff/);
  assert.match(provider, /return \(\) => setExternalMediaActive\(source, false\)/);
  assert.match(player, /useExperienceAudioHandoff\("spotify", true\)/);
  assert.match(fallback, /useExperienceAudioHandoff\("spotify", showEmbed\)/);
  assert.match(rankedGroove, /playCue\("listen-boot"\)/);
  assert.match(rankedGroove, /playCue\("listen-nav"\)/);
  assert.match(rankedGroove, /playCue\("listen-open-close"\)/);
  assert.match(fallback, /playCue\("listen-open-close"\)/);
});

test("simulation cues follow deterministic campaign and arena transitions", async () => {
  const [campaign, arena] = await Promise.all([
    import(
      "../components/simulation/campaign/campaign-audio.ts"
    ),
    source("components/simulation/ActionArena.tsx"),
  ]);
  assert.deepEqual(
    ["boot", "act1Wave", "act2Wave", "act3Wave", "bossWave", "ending"].map(
      campaign.campaignAudioCueForState,
    ),
    [
      "simulation-boot",
      "simulation-act-1",
      "simulation-act-2",
      "simulation-act-3",
      "simulation-boss",
      "simulation-ending",
    ],
  );
  assert.equal(campaign.campaignAudioCueForState("act1Debrief"), null);
  assert.deepEqual(
    ["near-miss", "hit", "evidence", "recalibrate"].map(
      campaign.arenaFeedbackAudioCue,
    ),
    [
      "simulation-near-miss",
      "simulation-hit",
      "simulation-evidence",
      "simulation-recalibrate",
    ],
  );
  assert.match(arena, /feedbackRef\.current\?\.\("near-miss"\)/);
  assert.match(arena, /this\.time\.now - this\.lastNearMissAt >= 700/);
});
