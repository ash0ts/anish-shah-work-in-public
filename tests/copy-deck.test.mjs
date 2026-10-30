import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import {
  buildCopyDeck,
  copyChangedPaths,
  parseCopyDocument,
} from "../scripts/lib/copy-deck.mjs";
import {
  buildCopyOwnershipReport,
  CopyOwnershipError,
  GIT_OWNED_WORK_GROUP_FIELDS,
} from "../lib/copy-ownership.ts";
import { COPY_PAGE_DEFINITIONS } from "../lib/copy-contract.ts";
import { validateEditorialPatchOwnership } from "../lib/server/editorial-policy.ts";
const {
  buildHomeStructuredData,
  socialArtworkAlt,
  socialPageTitle,
} = await tsImport("../lib/seo.ts", import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the copy deck accounts for every public WorkGroup by stable ID", async () => {
  const deck = await buildCopyDeck(root);
  const publicIds = deck.publicBundle.workGroups
    .filter((group) => group.publicationState === "public")
    .map((group) => group.id)
    .sort();
  assert.deepEqual(Object.keys(deck.workGroups).sort(), publicIds);
  assert.match(deck.copyVersion, /^[a-f0-9]{16}$/u);
  assert.equal((await buildCopyDeck(root)).copyVersion, deck.copyVersion);
});

test("COPY_VERSION includes the reviewed Home signal and rail contract", async () => {
  const source = await readFile(
    path.join(root, "scripts/lib/copy-deck.mjs"),
    "utf8",
  );
  assert.match(source, /content\/presentation\/home-overview\.v2\.json/u);
  assert.match(source, /content\/presentation\/speaker-profile\.v1\.json/u);
});

test("speaker copy keeps factual content in fact-check fields", async () => {
  const deck = await buildCopyDeck(root);
  const definitions = new Map(
    COPY_PAGE_DEFINITIONS.about.map((definition) => [definition.key, definition]),
  );
  for (const key of [
    "speaker-bio",
    "speaker-topic-agent-systems",
    "speaker-topic-agent-systems-description",
    "speaker-topic-evaluation-observability",
    "speaker-topic-evaluation-observability-description",
    "speaker-topic-education-community",
    "speaker-topic-education-community-description",
  ]) {
    assert.equal(definitions.get(key)?.risk, "fact_check", key);
    assert.equal(typeof deck.pages.about[key], "string", key);
  }
  for (const key of [
    "speaker-eyebrow",
    "speaker-topics-heading",
    "speaker-copy-cta",
    "speaker-work-cta",
    "speaker-linkedin-cta",
  ]) {
    assert.equal(definitions.get(key)?.risk, "editorial", key);
    assert.equal(typeof deck.pages.about[key], "string", key);
  }
});

test("curated WorkGroup copy stays meaningful and free of importer residue", async () => {
  const deck = await buildCopyDeck(root);
  for (const group of deck.publicBundle.workGroups.filter(
    (candidate) => candidate.publicationState === "public",
  )) {
    const copy = deck.workGroups[group.id];
    assert(copy.displayTitle.length > 2, `${group.id} needs a display title`);
    assert(copy.shortTitle.length <= 70, `${group.id} needs a metadata-safe short title`);
    assert(copy.summary.length > 20, `${group.id} needs a meaningful summary`);
    assert(copy.roleSummary.length > 2, `${group.id} needs a role summary`);
    assert.doesNotMatch(copy.summary, /https?:\/\//u);
    assert.doesNotMatch(copy.summary, /^A public\b/iu);
    assert.doesNotMatch(copy.summary, /(?:imported|source row|unknown role)/iu);
  }
});

test("copy values reject markup, links, templates, local paths, and control characters", () => {
  const definition = COPY_PAGE_DEFINITIONS.home.find(
    (candidate) => candidate.key === "primary-cta",
  );
  for (const malicious of [
    "<script>alert(1)</script>",
    "[Read this](https://example.com)",
    "https://example.com",
    "${process.env.SECRET}",
    "/Users/example/private-note.md",
    "hello\u0000world",
    "```js\nalert(1)\n```",
  ]) {
    assert.throws(
      () =>
        parseCopyDocument({
          file: "fixture.md",
          source: `<!-- copy-page: fixture -->\n\n## primary-cta\n${malicious}\n`,
          expectedMarker: "<!-- copy-page: fixture -->",
          definitions: [definition],
        }),
      /cannot contain|contains a|must be a single line/u,
    );
  }
});

test("copy fields reject metric claims while allowing years, model names, and 404", () => {
  const definition = COPY_PAGE_DEFINITIONS.home.find(
    (candidate) => candidate.key === "primary-cta",
  );
  const parse = (value) =>
    parseCopyDocument({
      file: "fixture.md",
      source: `<!-- copy-page: fixture -->\n\n## primary-cta\n${value}\n`,
      expectedMarker: "<!-- copy-page: fixture -->",
      definitions: [definition],
    });
  for (const metric of [
    "$4M+ supported pipeline",
    "67% returning users",
    "200K+ tool calls",
    "1,000 registrants",
    "500 attendees",
    "732 course enrollments",
    "42 users",
    "300 leads",
    "2M+",
    "four million dollars in pipeline",
    "seven thousand enrollments",
    "nearly all users returned",
    "a majority of organizations adopted it",
    "about half of course enrollments converted",
    "ninety percent of attendees returned",
  ]) {
    assert.throws(() => parse(metric), /quantitative metric wording/u, metric);
  }
  assert.equal(parse("From 2021 to now")["primary-cta"], "From 2021 to now");
  assert.equal(parse("GPT-4 and Phi-2")["primary-cta"], "GPT-4 and Phi-2");
  assert.equal(parse("Return from 404")["primary-cta"], "Return from 404");
});

test("site title templates preserve exactly one route-title placeholder", () => {
  const definition = COPY_PAGE_DEFINITIONS.site.find(
    (candidate) => candidate.key === "title-template",
  );
  const parse = (value) =>
    parseCopyDocument({
      file: "fixture.md",
      source: `<!-- copy-page: fixture -->\n\n## title-template\n${value}\n`,
      expectedMarker: "<!-- copy-page: fixture -->",
      definitions: [definition],
    });
  assert.equal(parse("%s — Anish Shah")["title-template"], "%s — Anish Shah");
  for (const invalid of ["Anish Shah", "%s — %s", "%s — 100% Anish"]) {
    assert.throws(() => parse(invalid), /exactly one %s placeholder/u);
  }
});

test("copy-field boundaries accept exact maxima and reject one character more", () => {
  for (const definition of [
    COPY_PAGE_DEFINITIONS.home.find((field) => field.key === "profile-headline"),
    COPY_PAGE_DEFINITIONS.home.find((field) => field.key === "primary-cta"),
    COPY_PAGE_DEFINITIONS.work.find((field) => field.key === "masthead-title"),
    COPY_PAGE_DEFINITIONS.site.find((field) => field.key === "not-found-body"),
  ]) {
    const exact = "x".repeat(definition.maxLength);
    const source = (value) =>
      `<!-- copy-page: fixture -->\n\n## ${definition.key}\n${value}\n`;
    assert.doesNotThrow(() =>
      parseCopyDocument({
        file: "fixture.md",
        source: source(exact),
        expectedMarker: "<!-- copy-page: fixture -->",
        definitions: [definition],
      }),
    );
    assert.throws(
      () =>
        parseCopyDocument({
          file: "fixture.md",
          source: source(`${exact}x`),
          expectedMarker: "<!-- copy-page: fixture -->",
          definitions: [definition],
        }),
      /maximum is/u,
    );
  }
});

test("editable identity copy stays synchronized across social and JSON-LD output", async () => {
  const deck = await buildCopyDeck(root);
  const identity = {
    siteName: "A. Shah",
    homeTitle: "Systems in public",
    titleTemplate: "A. Shah / %s",
    defaultTitle: "A. Shah / Systems in public",
  };
  assert.equal(socialPageTitle("Selected work", identity), "A. Shah / Selected work");
  assert.equal(socialArtworkAlt(identity), "A. Shah / Systems in public");

  const structured = buildHomeStructuredData(
    deck.publicBundle,
    "https://example.test/",
    identity,
  );
  const profilePage = structured["@graph"].find(
    (entry) => entry["@type"] === "ProfilePage",
  );
  const website = structured["@graph"].find(
    (entry) => entry["@type"] === "WebSite",
  );
  assert.equal(profilePage.name, "A. Shah / Systems in public");
  assert.equal(website.name, "A. Shah");
});

test("copy documents reject renamed, duplicate, unknown, and missing fields", () => {
  const definitions = [
    {
      key: "title",
      surface: "fixture",
      risk: "editorial",
      required: true,
      maxLength: 20,
      allowParagraphs: false,
    },
  ];
  const parse = (body) =>
    parseCopyDocument({
      file: "fixture.md",
      source: `<!-- copy-page: fixture -->\n\n${body}\n`,
      expectedMarker: "<!-- copy-page: fixture -->",
      definitions,
    });
  assert.throws(() => parse("## heading\nHello"), /unknown field/u);
  assert.throws(() => parse("## title\nHello\n\n## title\nAgain"), /duplicate field/u);
  assert.throws(() => parse(""), /missing required field/u);
  assert.throws(() => parse("## title renamed\nHello"), /invalid field heading/u);
});

test("editable Play flavor copy excludes guarded provider-policy literals", async () => {
  const [play, gallery, discogs, travel] = await Promise.all([
    readFile(path.join(root, "content/copy/pages/play.md"), "utf8"),
    readFile(path.join(root, "components/play/CollectionGallery.tsx"), "utf8"),
    readFile(path.join(root, "components/play/DiscogsStream.tsx"), "utf8"),
    readFile(path.join(root, "components/play/travel/PostcardPlanet.tsx"), "utf8"),
  ]);
  assert.doesNotMatch(
    play,
    /Spotify-calculated|returned order|play counts|visitor consent|official public movement feed|OAuth|retention|coverage/iu,
  );
  assert.match(gallery, /SITE_COPY\.play\["collection-search-placeholder"\]/u);
  assert.match(discogs, /SITE_COPY\.play\["collect-search-placeholder"\]/u);
  assert.match(travel, /SITE_COPY\.play\["travel-search-placeholder"\]/u);
});

test("Simulation presentation copy is deck-owned while model disclosures remain guarded", async () => {
  const [
    deck,
    campaignManifest,
    simulationPage,
    simulationComingSoon,
    campaignCopy,
  ] = await Promise.all([
    buildCopyDeck(root),
    readFile(
      path.join(root, "content/presentation/simulation.v1.json"),
      "utf8",
    ),
    readFile(path.join(root, "app/simulation/page.tsx"), "utf8"),
    readFile(
      path.join(root, "components/simulation/SimulationComingSoon.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "components/simulation/campaign/campaign-copy.ts"),
      "utf8",
    ),
  ]);

  assert.equal(deck.pages.simulation["ingress-cta"], "Reveal the simulation");
  assert.equal(
    deck.pages.simulation["boot-title"],
    "Beat the model’s first answer.",
  );
  assert.match(simulationPage, /SITE_COPY\.simulation\["seo-title"\]/u);
  assert.match(
    simulationPage,
    /SITE_COPY\.simulation\["coming-soon-seo-description"\]/u,
  );
  assert.match(simulationPage, /SITE_COPY\.simulation\["noscript-summary"\]/u);
  assert.equal(
    deck.pages.simulation["coming-soon-status"],
    "Campaign status · Coming soon",
  );
  for (const key of [
    "coming-soon-eyebrow",
    "coming-soon-title",
    "coming-soon-summary",
    "coming-soon-room-cta",
    "coming-soon-work-cta",
    "coming-soon-status",
  ]) {
    assert.match(
      simulationComingSoon,
      new RegExp(`SITE_COPY\\.simulation\\["${key}"\\]`, "u"),
    );
  }
  assert.equal(deck.pages.simulation["action-probe-label"], "Probe");
  assert.match(campaignCopy, /SIMULATION_ACTION_COPY_IDS\.map/u);
  assert.match(campaignCopy, /SITE_COPY\.simulation\[`action-\$\{action\}-hint`\]/u);
  assert.doesNotMatch(campaignCopy, /Ask what evidence could prove/u);

  const simulationCopy = await readFile(
    path.join(root, "content/copy/pages/simulation.md"),
    "utf8",
  );
  const manifest = JSON.parse(campaignManifest);
  assert.doesNotMatch(simulationCopy, /not Anish and can be wrong/iu);
  assert.match(manifest.persona.disclosure, /not Anish and can be wrong/iu);
});

test("fresh-clone lifecycle generates ignored copy before application checks", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const lifecycle of [
    "prepare",
    "predev",
    "prebuild",
    "pretypecheck",
    "prelint",
    "pretest",
    "prevalidate",
  ]) {
    assert.match(packageJson.scripts[lifecycle], /copy:generate/u, lifecycle);
  }
  const ignored = spawnSync("git", ["check-ignore", ".generated/site-copy.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0);
  const generated = await readFile(path.join(root, ".generated/site-copy.ts"), "utf8");
  assert.match(generated, /export const COPY_VERSION = "[a-f0-9]{16}"/u);
  assert.match(generated, /group:products:wandb-mcp/u);
});

test("copy:check validates the exact generated module", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-copy-deck.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Copy deck valid/u);
});

test("copy diff classification includes committed, working-tree, and untracked Markdown", () => {
  assert.deepEqual(
    copyChangedPaths(
      "content/copy/pages/home.md\nREADME.md\n",
      "content/copy/pages/site.md\n",
      "content/copy/work-groups/example.md\ncontent/copy/ignored.txt\n",
    ),
    [
      "content/copy/pages/home.md",
      "content/copy/pages/site.md",
      "content/copy/work-groups/example.md",
    ],
  );
});

test("editable 404 copy is typed, rendered, and reported against the 404 surface", async () => {
  const [deck, notFound] = await Promise.all([
    buildCopyDeck(root),
    readFile(path.join(root, "app/not-found.tsx"), "utf8"),
  ]);
  assert.equal(deck.pages.site["not-found-title"], "That page isn’t here.");
  assert.match(notFound, /SITE_COPY\.site\["not-found-title"\]/u);
  const { copyRiskManifest } = await import("../scripts/lib/copy-deck.mjs");
  const manifest = await copyRiskManifest(root);
  assert.equal(
    manifest.find((entry) => entry.key === "site.not-found-title")?.route,
    "/404",
  );
  assert.equal(
    manifest.find((entry) => entry.key === "play.travel-screen-title")?.route,
    "/play/travel",
  );
  assert.equal(
    manifest.find((entry) => entry.key === "play.loading-collection")?.route,
    "all-play-routes",
  );
  assert.equal(
    manifest.find((entry) => entry.key === "simulation.boot-title")?.route,
    "/simulation",
  );
});

test("Studio cannot overwrite Git-owned WorkGroup wording", async () => {
  assert.deepEqual(
    validateEditorialPatchOwnership("work_group", {
      approvedPublicWording: "A database override.",
    }),
    {
      ok: false,
      code: "copy_owned_field",
      message: "WorkGroup wording is owned by the reviewed Git copy deck.",
    },
  );
  assert.deepEqual(
    validateEditorialPatchOwnership("work_group", {
      caveat: "Owner-reviewed context.",
      visibility: "public",
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateEditorialPatchOwnership("metric", {
      approvedPublicWording: "Owner-reviewed metric wording.",
    }),
    { ok: true },
  );

  const studio = await readFile(
    path.join(root, "app/studio/EditorialRecords.tsx"),
    "utf8",
  );
  assert.match(studio, /copyOwnedWording = draft\?\.recordType === "work_group"/u);
  assert.match(studio, /content\/copy\/work-groups\/\{draft\.slug\}\.md/u);
});

test("copy ownership report enumerates deck paths and retained D1 wording safely", async () => {
  const deck = await buildCopyDeck(root);
  const [matchingGroup, differingGroup] = deck.publicBundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );
  const matchingSummary = deck.workGroups[matchingGroup.id].summary;
  const differingWording = "A retained public D1 summary awaiting owner review.";
  const report = buildCopyOwnershipReport([
    {
      id: matchingGroup.id,
      recordType: "work_group",
      approvedPublicWording: matchingSummary,
    },
    {
      id: differingGroup.id,
      recordType: "work_group",
      approvedPublicWording: differingWording,
    },
    {
      id: "group:removed:legacy",
      recordType: "work_group",
      approvedPublicWording: "A retired row must not enter the report.",
    },
    {
      id: matchingGroup.id,
      recordType: "metric",
      approvedPublicWording: "Metrics are outside WorkGroup copy ownership.",
    },
  ]);

  assert.equal(report.schemaVersion, "1.1");
  assert.match(report.copyVersion, /^[a-f0-9]{16}$/u);
  assert.equal(
    report.records.length,
    deck.publicBundle.workGroups.filter(
      (group) => group.publicationState === "public",
    ).length,
  );
  assert.deepEqual(report.summary, {
    workGroupCount: report.records.length,
    retainedD1WordingCount: 2,
    differingD1WordingCount: 1,
    missingD1RecordCount: report.records.length - 2,
  });
  assert.equal(report.surfaceSummary.surfaceCount, 7);
  assert.equal(
    report.surfaceSummary.fieldCount,
    Object.values(COPY_PAGE_DEFINITIONS).reduce(
      (total, definitions) => total + definitions.length,
      0,
    ),
  );
  assert.equal(
    report.surfaceSummary.riskCounts.editorial +
      report.surfaceSummary.riskCounts.fact_check,
    report.surfaceSummary.fieldCount,
  );
  const aboutSurface = report.surfaces.find(
    (surface) => surface.id === "about",
  );
  assert.deepEqual(aboutSurface?.routeScopes, ["/about"]);
  assert.equal(aboutSurface?.deckPath, "content/copy/pages/about.md");
  assert.deepEqual(
    aboutSurface?.fields.find((field) => field.key === "speaker-bio"),
    { key: "speaker-bio", risk: "fact_check" },
  );
  assert.deepEqual(
    aboutSurface?.fields.find((field) => field.key === "speaker-copy-cta"),
    { key: "speaker-copy-cta", risk: "editorial" },
  );
  assert.deepEqual(
    report.records.find((record) => record.id === matchingGroup.id),
    {
      id: matchingGroup.id,
      slug: matchingGroup.slug,
      deckPath: `content/copy/work-groups/${matchingGroup.slug}.md`,
      gitCopy: {
        displayTitle: deck.workGroups[matchingGroup.id].displayTitle,
        shortTitle: deck.workGroups[matchingGroup.id].shortTitle,
        summary: deck.workGroups[matchingGroup.id].summary,
        roleSummary: deck.workGroups[matchingGroup.id].roleSummary,
      },
      gitOwnedFields: GIT_OWNED_WORK_GROUP_FIELDS,
      d1RecordPresent: true,
      ignoredD1Wording: matchingSummary,
      ignoredD1WordingState: "matches_copy",
    },
  );
  assert.equal(
    report.records.find((record) => record.id === differingGroup.id)
      ?.ignoredD1WordingState,
    "differs_from_copy",
  );
  for (const record of report.records) {
    const current = deck.workGroups[record.id];
    assert.deepEqual(record.gitCopy, {
      displayTitle: current.displayTitle,
      shortTitle: current.shortTitle,
      summary: current.summary,
      roleSummary: current.roleSummary,
    });
    assert.equal(
      record.deckPath,
      `content/copy/work-groups/${record.slug}.md`,
    );
  }
  assert.equal(
    report.records.some((record) => record.id === "group:removed:legacy"),
    false,
  );

  const privateValue = "/Users/example/private-copy.md";
  assert.throws(
    () =>
      buildCopyOwnershipReport([
        {
          id: matchingGroup.id,
          recordType: "work_group",
          approvedPublicWording: privateValue,
        },
      ]),
    (error) =>
      error instanceof CopyOwnershipError &&
      error.code === "invalid_copy_ownership_state" &&
      !error.message.includes(privateValue),
  );
});

test("copy ownership API and Studio surface stay owner-only, read-only, and no-store", async () => {
  const [route, server, component, editor, page] = await Promise.all([
    readFile(
      path.join(root, "app/api/studio/copy-ownership/route.ts"),
      "utf8",
    ),
    readFile(path.join(root, "lib/server/copy-ownership.ts"), "utf8"),
    readFile(path.join(root, "app/studio/CopyOwnershipSummary.tsx"), "utf8"),
    readFile(path.join(root, "app/studio/EditorialRecords.tsx"), "utf8"),
    readFile(path.join(root, "app/studio/page.tsx"), "utf8"),
  ]);

  assert.match(
    route,
    /export async function GET\(\)[\s\S]*authorizeOwnerApi\(\)[\s\S]*getCopyOwnershipReport\(\)/u,
  );
  assert.match(route, /"cache-control": "private, no-store"/u);
  assert.match(route, /"x-robots-tag": "noindex, nofollow, noarchive"/u);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/u);
  assert.match(server, /recordType: "work_group"/u);
  assert.match(server, /buildCopyOwnershipReport\(result\.records\)/u);
  assert.doesNotMatch(server, /ensureSanitizedPublicRecords|INSERT|UPDATE|DELETE/u);

  assert.match(component, /Public copy lives in Git\./u);
  assert.match(component, /report\.surfaceSummary\.riskCounts\.editorial/u);
  assert.match(component, /report\.surfaces\.map/u);
  assert.match(component, /Retained D1 values ignored/u);
  assert.match(component, /href="\/api\/studio\/copy-ownership"/u);
  assert.doesNotMatch(component, /<(?:input|textarea|select|button)\b/u);
  for (const field of [
    "displayTitle",
    "shortTitle",
    "summary",
    "roleSummary",
  ]) {
    assert.match(editor, new RegExp(`copyOwnershipRecord\\.gitCopy\\.${field}`, "u"));
  }
  assert.match(editor, /Git-owned wording · read only/u);
  assert.match(editor, /Studio cannot overwrite them\./u);
  assert.match(editor, /<dl className=\{styles\.copyDeckFields\}>/u);
  assert.doesNotMatch(
    editor,
    /copyOwnershipRecord\.gitCopy\.[\s\S]{0,120}<input/u,
  );
  assert.match(page, /<CopyOwnershipSummary report=\{copyOwnershipReport\}/u);
  assert.match(page, /copyOwnershipReport=\{copyOwnershipReport\}/u);
});

test("copy-specific pull request template captures editorial review and code requests", async () => {
  const template = await readFile(
    path.join(root, ".github/PULL_REQUEST_TEMPLATE/copy-change.md"),
    "utf8",
  );
  for (const heading of [
    "Audience and objective",
    "Affected pages or WorkGroups",
    "Before and after",
    "Factual claims touched",
    "SEO and social presentation",
    "Implementation or visual requests",
    "Preview review",
    "Protected boundaries",
  ]) {
    assert.match(template, new RegExp(`^## ${heading}$`, "mu"));
  }
  assert.match(template, /Do not edit application code in a copy-only PR/u);
  assert.match(template, /No generated file, credential, private source, workflow, migration, or deployment file changed/u);
});

test("release and staging guards bind mutations and attestations to COPY_VERSION", async () => {
  const [plan, command, attestation, staging] = await Promise.all([
    readFile(path.join(root, "scripts/write-release-plan.mjs"), "utf8"),
    readFile(path.join(root, "scripts/release-command.mjs"), "utf8"),
    readFile(path.join(root, "scripts/write-release-attestation.mjs"), "utf8"),
    readFile(path.join(root, "scripts/staging-release.mjs"), "utf8"),
  ]);
  assert.match(plan, /copyVersion,/u);
  assert.match(command, /plan\.copyVersion !== copyVersion/u);
  assert.match(attestation, /copyVersion: plan\.copyVersion/u);
  assert.match(staging, /copyVersion,/u);
  assert.match(staging, /plan\.copyVersion !== copyVersion/u);
  assert.match(plan, /releaseVersion,/u);
  assert.match(command, /plan\.releaseVersion !== releaseVersion/u);
  assert.match(attestation, /releaseVersion,/u);
  assert.match(staging, /plan\.releaseVersion !== releaseVersion/u);
});
