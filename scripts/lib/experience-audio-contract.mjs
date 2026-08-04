import { createHash } from "node:crypto";

const CUE_ID = /^[a-z][a-z0-9-]{0,47}$/;
const NOTE = /^[A-G](?:#|b)?[0-8]$/;
const VOICES = new Set(["chip", "bass"]);

export const REQUIRED_EXPERIENCE_AUDIO_CUES = Object.freeze([
  "sound-on",
  "room-enter",
  "interface-confirm",
  "interface-return",
  "simulation-reveal",
  "memory-wafer",
  "watch-power",
  "watch-tune",
  "watch-select",
  "read-page",
  "read-select",
  "listen-boot",
  "listen-nav",
  "listen-open-close",
  "collect-crate",
  "collect-sleeve",
  "collect-select",
  "play-computer-boot",
  "play-load",
  "play-select",
  "move-belt",
  "move-tv",
  "move-status",
  "robot-arrival",
  "robot-squash",
  "robot-bite",
  "robot-swallow",
  "robot-crt-open",
  "robot-mind-dive",
  "simulation-boot",
  "simulation-act-1",
  "simulation-act-2",
  "simulation-act-3",
  "simulation-boss",
  "simulation-near-miss",
  "simulation-hit",
  "simulation-evidence",
  "simulation-action",
  "simulation-dialogue-ready",
  "simulation-fallback",
  "simulation-victory",
  "simulation-recalibrate",
  "simulation-ending",
]);

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

export function validateExperienceAudioManifest(value) {
  const errors = [];
  if (
    !exactKeys(value, [
      "schemaVersion",
      "engine",
      "masterGainDb",
      "externalMediaDuckDb",
      "cues",
    ])
  ) {
    errors.push("Manifest root fields do not match the v1 contract.");
    return errors;
  }
  if (value.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0.");
  if (value.engine !== "tone-procedural") {
    errors.push("engine must be tone-procedural.");
  }
  if (
    typeof value.masterGainDb !== "number" ||
    value.masterGainDb < -30 ||
    value.masterGainDb > -10
  ) {
    errors.push("masterGainDb must remain between -30 and -10 dB.");
  }
  if (
    typeof value.externalMediaDuckDb !== "number" ||
    value.externalMediaDuckDb < -60 ||
    value.externalMediaDuckDb > -24 ||
    (typeof value.masterGainDb === "number" &&
      value.externalMediaDuckDb > value.masterGainDb - 6)
  ) {
    errors.push(
      "externalMediaDuckDb must remain between -60 and -24 dB and at least 6 dB below master gain.",
    );
  }
  if (!value.cues || typeof value.cues !== "object" || Array.isArray(value.cues)) {
    errors.push("cues must be an object.");
    return errors;
  }
  const cueEntries = Object.entries(value.cues);
  if (cueEntries.length < 1 || cueEntries.length > 64) {
    errors.push("The manifest must contain between 1 and 64 cues.");
  }
  for (const cueId of REQUIRED_EXPERIENCE_AUDIO_CUES) {
    if (!Object.hasOwn(value.cues, cueId)) {
      errors.push(`Required cue ${cueId} is missing.`);
    }
  }
  for (const [cueId, cue] of cueEntries) {
    if (!CUE_ID.test(cueId)) errors.push(`Cue ID ${cueId} is invalid.`);
    if (!exactKeys(cue, ["description", "events"])) {
      errors.push(`Cue ${cueId} has unknown or missing fields.`);
      continue;
    }
    if (
      typeof cue.description !== "string" ||
      cue.description.trim().length < 8 ||
      cue.description.length > 180
    ) {
      errors.push(`Cue ${cueId} has an invalid description.`);
    }
    if (!Array.isArray(cue.events) || cue.events.length < 1 || cue.events.length > 12) {
      errors.push(`Cue ${cueId} must contain between 1 and 12 events.`);
      continue;
    }
    let priorOffset = -1;
    for (const [index, event] of cue.events.entries()) {
      if (
        !exactKeys(event, [
          "voice",
          "note",
          "offsetSeconds",
          "durationSeconds",
          "velocity",
        ])
      ) {
        errors.push(`Cue ${cueId} event ${index} has unknown or missing fields.`);
        continue;
      }
      if (!VOICES.has(event.voice)) {
        errors.push(`Cue ${cueId} event ${index} uses an unknown voice.`);
      }
      if (typeof event.note !== "string" || !NOTE.test(event.note)) {
        errors.push(`Cue ${cueId} event ${index} has an invalid note.`);
      }
      if (
        typeof event.offsetSeconds !== "number" ||
        event.offsetSeconds < 0 ||
        event.offsetSeconds > 4 ||
        event.offsetSeconds < priorOffset
      ) {
        errors.push(`Cue ${cueId} event ${index} has an invalid offset.`);
      }
      priorOffset = event.offsetSeconds;
      if (
        typeof event.durationSeconds !== "number" ||
        event.durationSeconds < 0.03 ||
        event.durationSeconds > 2
      ) {
        errors.push(`Cue ${cueId} event ${index} has an invalid duration.`);
      }
      if (
        typeof event.velocity !== "number" ||
        event.velocity < 0.05 ||
        event.velocity > 0.55
      ) {
        errors.push(`Cue ${cueId} event ${index} has an unsafe velocity.`);
      }
    }
  }
  return errors;
}

export function canonicalExperienceAudioManifest(value) {
  const cues = Object.fromEntries(
    Object.entries(value.cues)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, cue]) => [
        id,
        {
          description: cue.description.trim(),
          events: cue.events.map((event) => ({ ...event })),
        },
      ]),
  );
  return {
    schemaVersion: value.schemaVersion,
    engine: value.engine,
    masterGainDb: value.masterGainDb,
    externalMediaDuckDb: value.externalMediaDuckDb,
    cues,
  };
}

export function experienceAudioManifestHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalExperienceAudioManifest(value)))
    .digest("hex");
}
