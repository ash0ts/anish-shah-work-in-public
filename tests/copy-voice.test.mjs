import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PLAY_OBJECT_LANGUAGE,
  copyVoicePolicyForField,
  effectiveCopyRisk,
} from "../lib/copy-voice-contract.ts";
import { COPY_PAGE_DEFINITIONS } from "../lib/copy-contract.ts";
import {
  buildCopyDeck,
  parseCopyDocument,
} from "../scripts/lib/copy-deck.mjs";
import {
  assertCopyVoice,
  auditCopyVoice,
  copyVoiceEntries,
  countCopyWords,
} from "../scripts/lib/copy-voice.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function entry({
  key = "home.profile-summary",
  surface = "home",
  field = "profile-summary",
  value,
}) {
  return {
    key,
    surface,
    field,
    value,
    definition: copyVoicePolicyForField(surface, field),
  };
}

function rules(report, severity = "errors") {
  return report[severity].map((problem) => problem.rule);
}

test("voice profiles apply deterministic field budgets", () => {
  assert.equal(copyVoicePolicyForField("home", "primary-cta").maxWords, 6);
  assert.equal(copyVoicePolicyForField("work-group", "summary").minWords, 6);
  assert.equal(copyVoicePolicyForField("work-group", "summary").maxWords, 20);
  assert.equal(copyVoicePolicyForField("play", "watch-description").maxWords, 10);
  assert.equal(copyVoicePolicyForField("play", "watch-title").voiceProfile, "play-object-title");
  assert.equal(countCopyWords("Evaluation, observability, and tool interfaces."), 5);

  const report = auditCopyVoice([
    entry({
      key: "home.primary-cta",
      field: "primary-cta",
      value: "See all of the complete work archive now",
    }),
  ]);
  assert(rules(report).includes("field-budget"));
  assert.throws(() => assertCopyVoice(report), /field-budget/u);
});

test("WorkGroup summaries must be meaningful and artifact-first", () => {
  for (const value of [
    "Author.",
    "2:00 PM workshop",
    "In-person at the W&B office",
    "W&B Fully Connected editorial item",
  ]) {
    const report = auditCopyVoice([
      entry({
        key: "group:test.summary",
        surface: "work-group",
        field: "summary",
        value,
      }),
    ]);
    assert(
      rules(report).some((rule) => rule === "meaningless-summary" || rule === "field-budget"),
      value,
    );
  }

  const firstPerson = auditCopyVoice([
    entry({
      key: "group:test.summary",
      surface: "work-group",
      field: "summary",
      value: "I connected evaluation traces to the agent workflow so failures stayed inspectable.",
    }),
  ]);
  assert(rules(firstPerson).includes("artifact-first-summary"));

  const useful = auditCopyVoice([
    entry({
      key: "group:test.summary",
      surface: "work-group",
      field: "summary",
      value: "Evaluation traces keep failures inspectable inside the agent workflow.",
    }),
  ]);
  assert.equal(useful.errors.length, 0);
});

test("the complete deck obeys public first-person and density budgets", async () => {
  const deck = await buildCopyDeck(root);
  const entries = copyVoiceEntries(deck);
  const report = auditCopyVoice(entries);
  assert.deepEqual(report.errors, []);

  const summaries = Object.values(deck.workGroups).map((group) => group.summary);
  assert.equal(summaries.length, 82);
  assert(
    summaries.every(
      (summary) =>
        !/^(?:I|My)\b/u.test(summary) &&
        countCopyWords(summary) >= 6 &&
        countCopyWords(summary) <= 20,
    ),
  );
  for (const object of Object.keys(PLAY_OBJECT_LANGUAGE)) {
    const description = deck.pages.play[`${object}-description`];
    assert(countCopyWords(description) <= 10, `${object}: ${description}`);
    assert.doesNotMatch(description, /\b(?:I|me|my|mine|myself)\b/iu);
  }
  assert.doesNotMatch(
    deck.pages.work["seo-description"],
    /\b(?:I|me|my|mine|myself)\b/iu,
  );

  const metricBundle = JSON.parse(
    await readFile(
      path.join(root, "content/public/anish-content.public.v1.json"),
      "utf8",
    ),
  );
  const homePresentation = JSON.parse(
    await readFile(
      path.join(root, "content/presentation/home-signal-rails.v1.json"),
      "utf8",
    ),
  );
  const proofMetrics = [
    "metric:project:wandb-mcp-server:tool-calls:2026-07-29",
    "metric:courses:enrollments:2026-07-30",
    "metric:events:pipeline-supported:2024-2025",
  ];
  proofMetrics.forEach((metricId, offset) => {
    const metric = metricBundle.metrics.find((candidate) => candidate.id === metricId);
    assert(metric, metricId);
    const signal = homePresentation.signals[offset];
    assert.equal(signal.metricId, metricId);
    const compactCopy = [
      deck.pages.home[`proof-${offset + 1}-label`],
      signal.compactLimit,
    ].join(" ");
    assert(
      countCopyWords(compactCopy) <= 12,
      `${metricId} uses ${countCopyWords(compactCopy)} initially visible prose words`,
    );
    assert.equal(typeof metric.qualifier, "string");
    assert(metric.qualifier.length > 0);
    assert.equal(typeof metric.period?.label, "string");
    assert(metric.period.label.length > 0);
    assert.equal(typeof metric.attribution, "string");
    assert.equal(typeof metric.sourceLabel, "string");
  });
});

test("surface budgets reject first-person drift and dense page copy", () => {
  const firstPerson = auditCopyVoice([
    entry({ key: "work.masthead-title", surface: "work", field: "masthead-title", value: "I built this." }),
  ]);
  assert(rules(firstPerson).includes("first-person-budget"));

  const metadataFirstPerson = auditCopyVoice([
    entry({
      key: "work.seo-description",
      surface: "work",
      field: "seo-description",
      value: "Browse my agent systems and evaluation projects.",
    }),
  ]);
  assert(rules(metadataFirstPerson).includes("first-person-budget"));

  const denseAbout = auditCopyVoice([
    entry({
      key: "about.body",
      surface: "about",
      field: "body",
      value: Array.from({ length: 40 }, () => "systems").join(" "),
    }),
    entry({
      key: "about.current-focus",
      surface: "about",
      field: "current-focus",
      value: Array.from({ length: 20 }, () => "evaluation").join(" "),
    }),
  ]);
  assert(rules(denseAbout).includes("surface-word-budget"));
});

test("WorkGroup role summaries reject first-person sentence openings", () => {
  const report = auditCopyVoice([
    entry({
      key: "group:test.summary",
      surface: "work-group",
      field: "summary",
      value: "I authored a guide to tracing model behavior with evaluation data.",
    }),
    entry({
      key: "group:test.role-summary",
      surface: "work-group",
      field: "role-summary",
      value: "I authored the guide.",
    }),
  ]);
  assert(rules(report).includes("role-phrase"));
  assert(rules(report, "warnings").includes("summary-role-duplication"));
  assert.throws(() => assertCopyVoice(report), /role-phrase/u);
});

test("WorkGroup role summaries accept concise role phrases", () => {
  const policy = copyVoicePolicyForField("work-group", "role-summary");
  assert.equal(policy.voiceProfile, "work-role-summary");
  assert.equal(policy.minWords, 2);
  assert.equal(policy.maxWords, 12);

  const report = auditCopyVoice([
    entry({
      key: "group:test.role-summary",
      surface: "work-group",
      field: "role-summary",
      value: "Guide author",
    }),
  ]);
  assert.equal(report.errors.length, 0);
});

test("shared concise roles are labels rather than duplicate narrative", () => {
  const report = auditCopyVoice([
    entry({
      key: "group:first.role-summary",
      surface: "work-group",
      field: "role-summary",
      value: "Upstream contributor across two pull requests",
    }),
    entry({
      key: "group:second.role-summary",
      surface: "work-group",
      field: "role-summary",
      value: "Upstream contributor across two pull requests",
    }),
  ]);
  assert(!rules(report).includes("duplicate-sentence"));
  assert.equal(report.errors.length, 0);
});

test("unsupported hype, exclamation marks, and emoji fail professional copy", () => {
  for (const [value, expectedRule] of [
    ["A groundbreaking, best-in-class evaluation system.", "unsupported-hype"],
    ["See the work!", "professional-tone"],
    ["Evaluation systems 🚀", "professional-tone"],
  ]) {
    const report = auditCopyVoice([entry({ value })]);
    assert(rules(report).includes(expectedRule), value);
  }
});

test("numeric and currency claims require an adjacent period and limitation", () => {
  for (const value of ["$4M+ pipeline", "200K+ tool calls", "67% returning users"]) {
    const report = auditCopyVoice([entry({ value })]);
    assert(rules(report).includes("unqualified-number"), value);
  }

  const qualified = auditCopyVoice([
    entry({
      value: "$4M+ supported event pipeline across tracked 2024–2025 programs; not revenue.",
    }),
  ]);
  assert(!rules(qualified).includes("unqualified-number"));

  const benign = auditCopyVoice([
    entry({ value: "I began this line of work in 2021 with GPT-4 and Phi-2." }),
  ]);
  assert(!rules(benign).includes("unqualified-number"));
});

test("metric guards distinguish compact magnitudes from product model names", () => {
  const definition = COPY_PAGE_DEFINITIONS.home.find(
    (candidate) => candidate.key === "primary-cta",
  );
  assert.doesNotThrow(() =>
    parseCopyDocument({
      file: "fixture.md",
      source: "<!-- copy-page: fixture -->\n\n## primary-cta\nPhi-2 MLOps session\n",
      expectedMarker: "<!-- copy-page: fixture -->",
      definitions: [definition],
    }),
  );
  assert.throws(
    () =>
      parseCopyDocument({
        file: "fixture.md",
        source: "<!-- copy-page: fixture -->\n\n## primary-cta\n2M+ users\n",
        expectedMarker: "<!-- copy-page: fixture -->",
        definitions: [definition],
      }),
    /quantitative metric wording/u,
  );
});

test("protected wording cannot be hidden inside an editable copy field", () => {
  const probes = [
    ["home", "primary-cta", "Browse ARR results"],
    ["play", "listen-description", "Spotify refreshes access after visitor consent."],
    ["play", "travel-seo-description", "Browse exact GPS coordinates and a live location for each trip."],
    ["simulation", "boot-summary", "Meet an authoritative digital representative that retains every answer."],
  ];

  for (const [surface, key, value] of probes) {
    const definition = COPY_PAGE_DEFINITIONS[surface].find(
      (candidate) => candidate.key === key,
    );
    assert(definition, `${surface}.${key}`);
    assert.throws(
      () =>
        parseCopyDocument({
          file: "fixture.md",
          source: `<!-- copy-page: fixture -->\n\n## ${key}\n${value}\n`,
          expectedMarker: "<!-- copy-page: fixture -->",
          definitions: [definition],
        }),
      /protected claim, provider, privacy, location, or model-policy wording/u,
      `${surface}.${key}`,
    );
  }
});

test("concrete factual language raises editorial copy to fact-check review", () => {
  assert.equal(
    effectiveCopyRisk("editorial", "Open the room"),
    "editorial",
  );
  assert.equal(
    effectiveCopyRisk("editorial", "Spotify puts these tracks closest to the surface."),
    "fact_check",
  );
  assert.equal(
    effectiveCopyRisk("editorial", "I built this integration in 2026."),
    "fact_check",
  );
  assert.equal(
    effectiveCopyRisk("fact_check", "A concise label"),
    "fact_check",
  );
});

test("duplicate narrative sentences fail across public surfaces", () => {
  const repeated = "I keep the evidence beside the claim so its limits remain visible.";
  const report = auditCopyVoice([
    entry({ key: "home.profile-summary", value: repeated }),
    entry({
      key: "sources.intro-fallback",
      surface: "sources",
      field: "intro-fallback",
      value: repeated,
    }),
  ]);
  assert(rules(report).includes("duplicate-sentence"));

  const metadataRepeat = auditCopyVoice([
    entry({ key: "home.profile-summary", value: repeated }),
    entry({
      key: "home.seo-description",
      field: "seo-description",
      value: repeated,
    }),
  ]);
  assert(!rules(metadataRepeat).includes("duplicate-sentence"));
});

test("Play titles use the literal object names associated with each category", () => {
  const valid = Object.entries(PLAY_OBJECT_LANGUAGE).map(([object, requirement]) =>
    entry({
      key: `play.${object}-title`,
      surface: "play",
      field: `${object}-title`,
      value: requirement.objectName,
    }),
  );
  assert.equal(auditCopyVoice(valid).errors.length, 0);

  const invalid = valid.map((candidate) =>
    candidate.key === "play.watch-title"
      ? { ...candidate, value: "Midnight Signal" }
      : candidate,
  );
  const report = auditCopyVoice(invalid);
  assert(rules(report).includes("play-object-name"));
  assert.match(
    report.errors.find((problem) => problem.rule === "play-object-name").message,
    /Watch.*TV/u,
  );
});

test("generic openings, filler, repetition, and long sentences warn without failing", () => {
  const report = auditCopyVoice([
    entry({
      value: "A public ecosystem can leverage robust systems, robust interfaces, and robust workflows while this intentionally long sentence keeps adding abstract framing without naming the result, mechanism, evidence, or practical reason that a reader should care about it.",
    }),
  ]);
  const warningRules = rules(report, "warnings");
  assert(warningRules.includes("generic-opening"));
  assert(warningRules.includes("filler-language"));
  assert(warningRules.includes("local-repetition"));
  assert(warningRules.includes("long-sentence"));
  assert.equal(report.errors.length, 0);
  assert.doesNotThrow(() => assertCopyVoice(report));
});

test("bland verbs and repeated Work summary openings are reported", () => {
  const report = auditCopyVoice([
    entry({
      key: "group:first.summary",
      surface: "work-group",
      field: "summary",
      value: "Evaluation traces mapped failures across agent runs for closer review.",
    }),
    entry({
      key: "group:second.summary",
      surface: "work-group",
      field: "summary",
      value: "Evaluation traces mapped retrieval failures before deployment decisions.",
    }),
  ]);
  const warningRules = rules(report, "warnings");
  assert(warningRules.includes("bland-verb"));
  assert(warningRules.includes("repeated-summary-opening"));
  assert.equal(report.errors.length, 0);
});

test("package scripts enforce voice validation without an external style service", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["copy:voice"], "node scripts/copy-voice-check.mjs");
  assert.match(packageJson.scripts["copy:audit"], /copy-voice-check\.mjs --audit/u);
  assert.match(packageJson.scripts["copy:check"], /copy-voice-check\.mjs/u);
  assert.match(packageJson.scripts["copy:test"], /tests\/copy-voice\.test\.mjs/u);
  assert.doesNotMatch(
    `${packageJson.scripts["copy:voice"]} ${packageJson.scripts["copy:audit"]}`,
    /https?:|openai|anthropic|fetch|curl/iu,
  );

  const deckImplementation = await readFile(
    path.join(root, "scripts/lib/copy-deck.mjs"),
    "utf8",
  );
  assert.match(deckImplementation, /lib\/copy-voice-contract\.ts/u);
  assert.match(deckImplementation, /scripts\/lib\/copy-voice\.mjs/u);
});
