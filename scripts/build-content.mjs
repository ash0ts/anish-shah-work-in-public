#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "./lib/csv.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = path.resolve(PROJECT_ROOT, "..");

const SOURCE_FILES = {
  footprintCsv: path.join(SOURCE_ROOT, "anish_shah_public_footprint_2021-2026.csv"),
  footprintMarkdown: path.join(SOURCE_ROOT, "anish_shah_public_footprint_2021-2026.md"),
  impactCsv: path.join(SOURCE_ROOT, "anish_shah_impact_metrics_2021-2026.csv"),
  impactMarkdown: path.join(SOURCE_ROOT, "anish_shah_impact_report_2021-2026.md"),
  curation: path.join(PROJECT_ROOT, "content/curation/content-v1.1.json"),
  workGroups: path.join(PROJECT_ROOT, "content/curation/work-groups.v1.json"),
  metricGroups: path.join(PROJECT_ROOT, "content/presentation/metric-groups.v1.json"),
  claimUpgrades: path.join(
    PROJECT_ROOT,
    "content/curation/public-claim-upgrades.v1.json",
  ),
};

const OUTPUT_FILES = {
  owner: path.join(PROJECT_ROOT, "content/private/anish-content.v1.json"),
  public: path.join(PROJECT_ROOT, "content/public/anish-content.public.v1.json"),
  schema: path.join(PROJECT_ROOT, "content/schema/anish-content.schema.json"),
  report: path.join(PROJECT_ROOT, "content/reports/migration-quality.md"),
};

const EXPECTED_FOOTPRINT_ROWS = 184;
const EXPECTED_IMPACT_ROWS = 85;
const PLAN_BASELINE_IMPACT_ROWS = 61;
const SCHEMA_VERSION = "1.2";
const CURATION_SCHEMA_VERSION = "1.1";
const PRESENTATION_SCHEMA_VERSION = "1.0";

const BROKEN_MLOPS_URL =
  "https://home.mlops.community/en/public/blogs/how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-and-biases-2";
const CORRECT_MLOPS_URL =
  "https://home.mlops.community/en/public/blogs/how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-biases-2";

const BLOCKED_PUBLIC_TEXT = [
  "app.notion.com",
  "notion.so",
  "app.hex.tech",
  "coreweave.enterprise.slack.com",
  "slack.com/archives",
  "/users/",
  "documents/new project",
];

const TYPE_ORDER = [
  "course",
  "article",
  "technical_report",
  "open_source_repo",
  "open_source_pr",
  "event",
  "recording",
  "producer_credit",
  "external_reference",
  "translation",
  "mirror",
  "profile",
];

const APPROVED_PUBLIC_DISPLAYS = new Set([
  "7K+",
  "About half",
  "1K+",
  "200K+",
  "More than two-thirds",
  "Hundreds",
  "$4M+",
  "$300K+",
  "500+",
  "1K+ / 500+",
  "49",
  "19+",
]);

const WORK_BUCKETS = new Set([
  "products-open-source",
  "courses-learning",
  "writing-research",
  "talks-programs",
]);

const WORK_GROUPING_DECISIONS = new Set([
  "same_story",
  "same_occurrence_representation",
  "program_sibling",
  "standalone",
  "reference_only",
]);

const METRIC_THEMES = new Set(["learning", "product", "programs", "archive"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

function slugify(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[’']/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 88) || "untitled"
  );
}

function unboundedSlug(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[’']/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
}

function stableRouteSlug(value, stableId) {
  const full = unboundedSlug(value);
  if (full.length <= 88) return full;
  const prefix = full.slice(0, 81);
  const boundary = prefix.lastIndexOf("-");
  const readable = prefix.slice(0, boundary >= 56 ? boundary : 81).replace(/-+$/, "");
  return `${readable}-${shortHash(stableId, 6)}`;
}

function normalizedTitle(value) {
  return unboundedSlug(value)
    .replace(/-(apple-podcasts|spotify|amazon-music|transcript-video-page|forem)$/, "")
    .replace(/-part-[0-9]+$/, "");
}

function exactNormalizedTitle(value) {
  return unboundedSlug(value);
}

function normalizeUrl(url) {
  if (!url) return "";
  const corrected = url.trim() === BROKEN_MLOPS_URL ? CORRECT_MLOPS_URL : url.trim();
  try {
    const parsed = new URL(corrected);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_")) parsed.searchParams.delete(key);
    }
    if (parsed.hostname === "youtu.be") {
      return `https://www.youtube.com/watch?v=${parsed.pathname.replace(/^\//, "")}`;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return corrected.replace(/\/+$/, "");
  }
}

function canonicalPublicUrl(url) {
  if (!url) return "";
  return url.trim() === BROKEN_MLOPS_URL ? CORRECT_MLOPS_URL : url.trim();
}

function datePrecision(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  if (/^\d{4}$/.test(value)) return "year";
  return "unknown";
}

function dateBasis(row) {
  if (row.category === "event") return "event_date";
  if (row.category === "recording") {
    if (/\bupload date\b/i.test(row.notes)) return "upload_date";
    if (/\buploaded\b|\breplay published\b/i.test(row.notes)) return "event_date";
    return "publication_date";
  }
  if (row.date_start || row.year) return "publication_date";
  return "unknown";
}

const MONTHS = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].map((month, index) => [month, String(index + 1).padStart(2, "0")]),
);

function parseAdditionalDates(row) {
  const dates = [];
  const pattern =
    /\b(uploaded|replay published)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/gi;
  for (const match of row.notes.matchAll(pattern)) {
    const year = match[4] || row.year;
    if (!year) continue;
    const value = `${year}-${MONTHS.get(match[2].toLowerCase())}-${String(match[3]).padStart(2, "0")}`;
    dates.push({
      label: match[1].toLowerCase() === "uploaded" ? "Recording uploaded" : "Replay published",
      start: value,
      end: null,
      precision: "day",
      basis: "upload_date",
    });
  }
  return dates;
}

function parseDurationSeconds(notes) {
  const match = notes.match(/(?:^|;\s*)(\d{1,2}:\d{2}(?::\d{2})?)(?:;|$)/);
  if (!match) return null;
  const parts = match[1].split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

function locationKind(label) {
  const value = label.toLowerCase();
  if (!value) return "unknown";
  if (/youtube|brighttalk|podcast|web|github|nvidia on-demand/.test(value)) return "platform";
  if (value.includes("hybrid") || (value.includes("online") && value.includes("/"))) return "hybrid";
  if (value.includes("online") || value.includes("virtual")) return "online";
  return "physical";
}

function inferTopics(row) {
  const haystack = `${row.title} ${row.notes} ${row.organization}`.toLowerCase();
  const rules = [
    ["agents", /\bagent(?:s|ic)?\b|multi-agent/],
    ["mcp", /\bmcp\b|model context protocol/],
    ["evaluation", /\beval(?:s|uation|uating)?\b|llm judge/],
    ["fine-tuning", /fine[- ]?tun|prompt-tun|p-tun/],
    ["llms", /\bllm|large language model|gpt-|genai|generative ai/],
    ["mlops", /\bmlops\b|model monitoring|experiment tracking/],
    ["rag", /\brag\b|retrieval augmented/],
    ["weave", /\bweave\b/],
    ["multimodal", /multimodal/],
    ["open-source", /github|open.source|repository|pull request/],
    ["education", /course|workshop|class|instructor|tutorial/],
    ["community", /meetup|conference|podcast|community/],
    ["healthcare", /medical|healthcare|biomedical|drug discovery/],
    ["cloud", /azure|google cloud|snowflake|aws/],
  ];
  const topics = rules.filter(([, pattern]) => pattern.test(haystack)).map(([topic]) => topic);
  if (row.category === "course" && !topics.includes("education")) topics.push("education");
  return [...new Set(topics)].sort();
}

function verificationFromConfidence(confidence) {
  if (confidence === "high") return "verified";
  if (confidence === "medium-high") return "corroborated";
  return "listed_unconfirmed";
}

function makeOrganizationId(name) {
  return `org:${slugify(name)}`;
}

function makePortfolioItems(rows, curation) {
  const candidates = rows.map((row, index) => {
    const start = row.date_start || row.year || null;
    const fingerprint = sha256(
      [row.category, row.title, row.date_start, row.primary_url, row.secondary_url, row.organization].join(
        "\u001f",
      ),
    );
    const legacyBaseId = `${row.category}:${start || "undated"}:${slugify(row.title)}`;
    return { row, index, start, fingerprint, legacyBaseId };
  });

  const idCounts = countBy(candidates, (candidate) => candidate.legacyBaseId);
  const slugCounts = countBy(candidates, (candidate) => slugify(candidate.row.title));

  return candidates.map(({ row, index, start, fingerprint, legacyBaseId }) => {
    const id = `item:fp-${String(index + 1).padStart(4, "0")}`;
    const legacyId =
      idCounts.get(legacyBaseId) === 1
        ? legacyBaseId
        : `${legacyBaseId}:${shortHash(
            [row.primary_url, row.secondary_url, row.organization, row.role].join("\u001f"),
            8,
          )}`;
    const baseSlug = slugify(row.title);
    const legacySlug =
      slugCounts.get(baseSlug) === 1
        ? baseSlug
        : `${baseSlug}-${row.category}-${start || "undated"}-${shortHash(legacyId, 6)}`;
    const slug =
      unboundedSlug(row.title).length > 88
        ? stableRouteSlug(row.title, id)
        : legacySlug;
    const presentation = curation.itemPresentation[legacyId] || {};
    const publicStart = presentation.dateStart || start;
    const publicEnd = presentation.dateEnd || row.date_end || null;
    const publicDateBasis =
      presentation.dateBasis ||
      dateBasis({ ...row, date_start: publicStart, year: publicStart?.slice(0, 4) });
    const urls = [
      row.primary_url && { kind: "primary", url: canonicalPublicUrl(row.primary_url) },
      row.secondary_url && { kind: "secondary", url: canonicalPublicUrl(row.secondary_url) },
    ].filter(Boolean);
    const organizationIds = row.organization ? [makeOrganizationId(row.organization)] : [];

    return {
      id,
      legacyIds: [legacyId],
      slug,
      slugAliases: slug === legacySlug ? [] : [legacySlug],
      type: row.category,
      title: row.title,
      displayTitle: presentation.displayTitle || row.title,
      shortTitle: presentation.shortTitle || presentation.displayTitle || row.title,
      date: {
        start: publicStart,
        end: publicEnd,
        precision: publicStart ? datePrecision(publicStart) : "unknown",
        basis: publicDateBasis,
      },
      additionalDates: parseAdditionalDates(row),
      year: publicStart ? Number(publicStart.slice(0, 4)) : null,
      role: row.role,
      organizationIds,
      location: {
        label: row.location,
        kind: locationKind(row.location),
      },
      status: row.status,
      urls,
      summary: row.notes || null,
      topics: inferTopics(row),
      durationSeconds: row.category === "recording" ? parseDurationSeconds(row.notes) : null,
      publicationState: "public",
      verificationState: verificationFromConfidence(row.confidence),
      evidenceIds: [],
      featured: false,
      canonicalEntityId: "",
      entityRole: "primary",
      sourceRecord: {
        snapshotId: "snapshot:public-footprint-csv",
        row: index + 2,
        fingerprint,
      },
    };
  });
}

function makeSupplementalItems(curation) {
  return curation.supplementalItems.map((entry) => {
    const start = entry.dateStart || null;
    const fingerprint = sha256(JSON.stringify(entry));
    return {
      id: entry.id,
      legacyIds: entry.legacyIds,
      slug: entry.slug,
      slugAliases: entry.slugAliases,
      type: entry.type,
      title: entry.title,
      displayTitle: entry.displayTitle,
      shortTitle: entry.shortTitle,
      date: {
        start,
        end: null,
        precision: start ? datePrecision(start) : "unknown",
        basis: "publication_date",
      },
      additionalDates: [],
      year: start ? Number(start.slice(0, 4)) : null,
      role: entry.role,
      organizationIds: entry.organization ? [makeOrganizationId(entry.organization)] : [],
      location: { label: "GitHub", kind: "platform" },
      status: entry.status,
      urls: [{ kind: "primary", url: canonicalPublicUrl(entry.primaryUrl) }],
      summary: entry.summary,
      topics: [...new Set(entry.topics)].sort(),
      durationSeconds: null,
      publicationState: "public",
      verificationState: entry.verificationState,
      evidenceIds: [],
      featured: false,
      canonicalEntityId: "",
      entityRole: "primary",
      sourceRecord: {
        snapshotId: entry.sourceSnapshotId,
        row: entry.sourceLine,
        fingerprint,
      },
    };
  });
}

function assertUniqueItemSlugs(items) {
  const bySlug = countBy(items, (item) => item.slug);
  for (const item of items) {
    if (bySlug.get(item.slug) !== 1) {
      throw new Error(`Curation produced duplicate item slug: ${item.slug}`);
    }
  }
}

function countBy(values, getKey) {
  const counts = new Map();
  for (const value of values) {
    const key = getKey(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function evidenceKind(url, itemType) {
  const hostname = new URL(url).hostname;
  if (hostname.includes("youtube.com") || hostname.includes("brighttalk.com")) return "video";
  if (hostname === "github.com" || hostname === "pypi.org") return "repository";
  if (itemType === "profile") return "profile";
  return "web_page";
}

function buildPublicEvidence(items, capturedAt) {
  const evidenceByUrl = new Map();
  for (const item of items) {
    for (const entry of item.urls) {
      const normalized = normalizeUrl(entry.url);
      if (!normalized) continue;
      if (!evidenceByUrl.has(normalized)) {
        const parsed = new URL(entry.url);
        evidenceByUrl.set(normalized, {
          id: `evidence:web:${shortHash(normalized)}`,
          title: item.title,
          kind: evidenceKind(entry.url, item.type),
          access: "public_web",
          url: entry.url,
          publisher: parsed.hostname.replace(/^www\./, ""),
          capturedAt,
          verificationState: item.verificationState,
        });
      }
      item.evidenceIds.push(evidenceByUrl.get(normalized).id);
    }
    item.evidenceIds = [...new Set(item.evidenceIds)];
  }

  evidenceByUrl.set("methodology:internal-analytics", {
    id: "evidence:methodology:internal-analytics",
    title: "Internal analytics — rounded public summary",
    kind: "methodology",
    access: "public_web",
    url: "/sources#internal-analytics",
    publisher: "anishshah.dev",
    capturedAt,
    verificationState: "corroborated",
  });
  evidenceByUrl.set("methodology:public-footprint", {
    id: "evidence:methodology:public-footprint",
    title: "Public footprint counting methodology",
    kind: "methodology",
    access: "public_web",
    url: "/sources#public-footprint",
    publisher: "anishshah.dev",
    capturedAt,
    verificationState: "derived",
  });

  return [...evidenceByUrl.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildOrganizations(rows, curation) {
  const names = [
    ...new Set([
      ...rows.map((row) => row.organization).filter(Boolean),
      ...curation.supplementalItems.map((item) => item.organization).filter(Boolean),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  return names.map((name) => ({ id: makeOrganizationId(name), name }));
}

function sameTitle(left, right) {
  return exactNormalizedTitle(left.title) === exactNormalizedTitle(right.title);
}

function typePriority(item) {
  const index = TYPE_ORDER.indexOf(item.type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function buildRelations(items, curation) {
  const relations = new Map();
  const itemsByUrl = new Map();
  for (const item of items) {
    for (const entry of item.urls) {
      const key = normalizeUrl(entry.url);
      if (!itemsByUrl.has(key)) itemsByUrl.set(key, []);
      itemsByUrl.get(key).push(item);
    }
  }

  const add = (fromId, toId, predicate, confidence, rationale) => {
    if (!fromId || !toId || fromId === toId) return;
    const key = `${fromId}\u001f${predicate}\u001f${toId}`;
    if (relations.has(key)) return;
    relations.set(key, {
      id: `relation:${predicate}:${shortHash(key)}`,
      fromId,
      toId,
      predicate,
      confidence,
      rationale,
    });
  };

  const targetForUrl = (url, sourceId, preferredTypes = []) => {
    const candidates = (itemsByUrl.get(normalizeUrl(url)) || [])
      .filter((item) => item.id !== sourceId)
      .sort((left, right) => {
        const leftPreferred = preferredTypes.indexOf(left.type);
        const rightPreferred = preferredTypes.indexOf(right.type);
        if (leftPreferred !== -1 || rightPreferred !== -1) {
          if (leftPreferred === -1) return 1;
          if (rightPreferred === -1) return -1;
          if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
        }
        return typePriority(left) - typePriority(right) || left.id.localeCompare(right.id);
      });
    return candidates[0] || null;
  };

  const recordingEventScore = (recording, event) => {
    let urlScore = 0;
    for (const recordingUrl of recording.urls) {
      for (const eventUrl of event.urls) {
        if (normalizeUrl(recordingUrl.url) !== normalizeUrl(eventUrl.url)) continue;
        const pair = `${recordingUrl.kind}:${eventUrl.kind}`;
        urlScore = Math.max(
          urlScore,
          {
            "primary:primary": 90,
            "primary:secondary": 70,
            "secondary:primary": 60,
            "secondary:secondary": 20,
          }[pair] || 10,
        );
      }
    }
    const titleScore = sameTitle(recording, event) ? 30 : 0;
    const dateScore =
      recording.date.start && recording.date.start === event.date.start
        ? 50
        : recording.date.start?.slice(0, 7) === event.date.start?.slice(0, 7)
          ? 25
          : 0;
    const organizationScore = recording.organizationIds.some((id) =>
      event.organizationIds.includes(id),
    )
      ? 10
      : 0;
    return {
      score: urlScore + titleScore + dateScore + organizationScore,
      urlScore,
      titleScore,
      dateScore,
    };
  };

  for (const item of items) {
    const secondary = item.urls.find((entry) => entry.kind === "secondary")?.url;

    if (item.type === "recording") {
      const events = items
        .filter((candidate) => candidate.type === "event")
        .map((candidate) => ({ candidate, ...recordingEventScore(item, candidate) }))
        .filter(({ urlScore, titleScore }) => urlScore > 0 || titleScore > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.urlScore - left.urlScore ||
            left.candidate.id.localeCompare(right.candidate.id),
        );
      const best = events[0];
      const tied = best && events[1]?.score === best.score && events[1]?.urlScore === best.urlScore;
      if (best && !tied) {
        add(
          item.id,
          best.candidate.id,
          "recording_of",
          "high",
          "Unique best match from typed URL roles, date, title, and organization.",
        );
      }
    }

    if (item.type === "mirror" && secondary) {
      const target = targetForUrl(secondary, item.id, ["recording", "article", "technical_report"]);
      if (target) add(item.id, target.id, "mirror_of", "high", "Secondary URL identifies the source.");
    }

    if (item.type === "translation" && secondary) {
      const target = targetForUrl(secondary, item.id, ["article", "technical_report"]);
      if (target) {
        add(item.id, target.id, "translation_of", "high", "Secondary URL identifies the original.");
      }
    }

    if (item.type === "external_reference" && secondary) {
      const target = targetForUrl(secondary, item.id);
      if (target) add(item.id, target.id, "references", "high", "Secondary URL identifies cited work.");
    }

    if (item.type === "producer_credit" && secondary) {
      const target = targetForUrl(secondary, item.id, ["recording", "course", "event"]);
      if (target) add(item.id, target.id, "part_of", "medium", "Credit links to the produced artifact.");
    }

    if (item.type === "open_source_pr") {
      const primary = item.urls.find((entry) => entry.kind === "primary")?.url;
      const match = primary?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i);
      if (match) {
        const repositoryUrl = `https://github.com/${match[1]}`;
        const target = targetForUrl(repositoryUrl, item.id, ["open_source_repo"]);
        if (target) add(item.id, target.id, "implements", "high", "Pull request belongs to the repository.");
      }
    }

    if (
      secondary &&
      /\bderivative\b|\brepackaged\b|\bre-recorded\b/i.test(`${item.status} ${item.summary || ""}`) &&
      item.type !== "mirror"
    ) {
      const target = targetForUrl(secondary, item.id, ["recording", "article", "technical_report"]);
      if (target) {
        add(item.id, target.id, "derivative_of", "medium", "Source notes identify derivative material.");
      }
    }
  }

  const addByTitle = (fromType, fromTitle, toType, toTitle, predicate, rationale) => {
    const from = itemByTitle(items, fromTitle, fromType);
    const to = itemByTitle(items, toTitle, toType);
    if (from && to) add(from.id, to.id, predicate, "high", rationale);
  };

  const translationTargets = [
    [
      "Automated PDF Summarization with Claude 3.5 Sonnet and W&B Weave — Korean",
      "article",
      "Automated PDF Summarization of arXiv Papers with Claude 3.5 Sonnet and W&B Weave",
    ],
    [
      "Automated PDF Summarization with Claude 3.5 Sonnet and W&B Weave — Japanese",
      "article",
      "Automated PDF Summarization of arXiv Papers with Claude 3.5 Sonnet and W&B Weave",
    ],
    [
      "Snowflake Arctic / PubMed RAG — Korean",
      "article",
      "How to Create a Biomedical RAG Application Using Snowflake Arctic for PubMed Paper Understanding",
    ],
    [
      "How to Save a Classifier to Disk in Scikit-learn — Japanese",
      "article",
      "How to Save a Classifier to Disk in Scikit-learn",
    ],
    [
      "L5Kit, Ray, and W&B Motion Prediction — Japanese",
      "article",
      "Scaling Out Motion Prediction for Autonomous Vehicles with L5Kit, Ray, and W&B",
    ],
    [
      "Prompt Engineering LLMs with LangChain and W&B — Korean",
      "article",
      "Prompt Engineering LLMs with LangChain and W&B",
    ],
    [
      "Prompt Engineering LLMs with LangChain and W&B — Japanese",
      "article",
      "Prompt Engineering LLMs with LangChain and W&B",
    ],
    [
      "Emad Mostaque / Stable Diffusion — Korean",
      "producer_credit",
      "Emad Mostaque: Stable Diffusion, Stability AI, and What's Next",
    ],
    [
      "Emad Mostaque / Stable Diffusion — Japanese",
      "producer_credit",
      "Emad Mostaque: Stable Diffusion, Stability AI, and What's Next",
    ],
    [
      "Will Falcon / Lightning — Korean",
      "producer_credit",
      "Will Falcon: Making Lightning the Apple of ML",
    ],
    [
      "Will Falcon / Lightning — Japanese",
      "producer_credit",
      "Will Falcon: Making Lightning the Apple of ML",
    ],
  ];
  for (const [translation, targetType, target] of translationTargets) {
    addByTitle(
      "translation",
      translation,
      targetType,
      target,
      "translation_of",
      "The inventory labels this as a translated mirror of the named public work.",
    );
  }

  const implementationTargets = [
    [
      "l5kit-ray-wandb-demo",
      "Scaling Out Motion Prediction for Autonomous Vehicles with L5Kit, Ray, and W&B",
    ],
    [
      "NeMo-Vertex-W-B-PTuning-LLM",
      "How to Adapt your LLM for Question Answering with Prompt-Tuning using NVIDIA NeMo and Weights & Biases",
    ],
    [
      "snowflake-arctic-weave-demo",
      "How to Create a Biomedical RAG Application Using Snowflake Arctic for PubMed Paper Understanding",
    ],
    [
      "wandb-mcp-server",
      "Introducing the W&B MCP Server: An Agent-Native Interface for Your Experiments and Traces",
    ],
  ];
  for (const [repository, article] of implementationTargets) {
    addByTitle(
      "open_source_repo",
      repository,
      "article",
      article,
      "implements",
      "The source inventory identifies this repository as the implementation artifact.",
    );
  }

  const partOfTargets = [
    ["Prompting course #142", "course", "Developer's Guide to LLM Prompting"],
    ["Evaluation course #1", "course", "LLM Apps: Evaluation"],
    ["Evaluation course #2", "course", "LLM Apps: Evaluation"],
    ["Agents course #2", "course", "AI Engineering: Agents"],
    [
      "W&B Weave arXiv cookbook #2005",
      "article",
      "Automated PDF Summarization of arXiv Papers with Claude 3.5 Sonnet and W&B Weave",
    ],
    [
      "W&B Weave arXiv cookbook #2089",
      "article",
      "Automated PDF Summarization of arXiv Papers with Claude 3.5 Sonnet and W&B Weave",
    ],
    [
      "W&B examples Azure medical notes #578",
      "article",
      "Automated Medical Note Generation: Fine-Tuning GPT Models for Clinical Documentation Using Azure OpenAI and Weights & Biases",
    ],
  ];
  for (const [pullRequest, targetType, target] of partOfTargets) {
    addByTitle(
      "open_source_pr",
      pullRequest,
      targetType,
      target,
      "part_of",
      "The inventory identifies this pull request as a contribution to the named artifact.",
    );
  }

  const referenceTargets = [
    [
      "LangChain v0.0.274 Release Notes",
      "open_source_pr",
      "LangChain #9771",
    ],
    [
      "Deep Learning Weekly Issue 340",
      "article",
      "How to Adapt your LLM for Question Answering with Prompt-Tuning using NVIDIA NeMo and Weights & Biases",
    ],
    [
      "How to Adapt Your LLM for Question Answering with Prompt-Tuning",
      "article",
      "How to Adapt your LLM for Question Answering with Prompt-Tuning using NVIDIA NeMo and Weights & Biases",
    ],
    [
      "Streamlit August Monthly Roundup",
      "article",
      "How to Create a Biomedical RAG Application Using Snowflake Arctic for PubMed Paper Understanding",
    ],
  ];
  for (const [reference, targetType, target] of referenceTargets) {
    addByTitle(
      "external_reference",
      reference,
      targetType,
      target,
      "references",
      "The inventory notes an explicit public citation or recommendation.",
    );
  }

  const itemForOverride = ({ itemId, legacyId }) =>
    itemId
      ? items.find((item) => item.id === itemId)
      : items.find((item) => item.legacyIds.includes(legacyId));
  for (const override of curation.relationOverrides) {
    const from = itemForOverride({
      itemId: override.fromItemId,
      legacyId: override.fromLegacyId,
    });
    const to = itemForOverride({
      itemId: override.toItemId,
      legacyId: override.toLegacyId,
    });
    if (!from || !to) {
      throw new Error(`Curation relation target is missing: ${JSON.stringify(override)}`);
    }
    add(
      from.id,
      to.id,
      override.predicate,
      override.confidence,
      override.rationale,
    );
  }

  return [...relations.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function itemByLegacyId(items, legacyId) {
  return items.find((item) => item.legacyIds.includes(legacyId));
}

function buildCanonicalEntities(items, relations, curation) {
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const find = (id) => {
    const current = parent.get(id);
    if (!current) throw new Error(`Unknown item while grouping: ${id}`);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (leftId, rightId) => {
    const left = find(leftId);
    const right = find(rightId);
    if (left === right) return;
    parent.set(right, left);
  };

  const groupingPredicates = new Set([
    "recording_of",
    "mirror_of",
    "translation_of",
    "part_of",
    "implements",
  ]);
  for (const relation of relations) {
    if (groupingPredicates.has(relation.predicate)) {
      union(relation.fromId, relation.toId);
    }
  }

  const resolveMembers = (definition) => [
    ...(definition.memberLegacyIds || []).map((legacyId) => {
      const item = itemByLegacyId(items, legacyId);
      if (!item) throw new Error(`Forced entity member is missing: ${legacyId}`);
      return item;
    }),
    ...(definition.memberItemIds || []).map((itemId) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error(`Forced entity member is missing: ${itemId}`);
      return item;
    }),
  ];

  for (const definition of curation.forcedEntities) {
    const members = resolveMembers(definition);
    for (const member of members.slice(1)) union(members[0].id, member.id);
  }

  const components = new Map();
  for (const item of items) {
    const root = find(item.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(item);
  }

  const primaryPriority = [
    "event",
    "course",
    "article",
    "technical_report",
    "open_source_repo",
    "producer_credit",
    "recording",
    "open_source_pr",
    "external_reference",
    "translation",
    "mirror",
    "profile",
  ];
  const entities = [];
  const componentEntityByItemId = new Map();

  const roleForItem = (item, primaryId) => {
    if (item.id === primaryId) return "primary";
    if (item.type === "recording") return "recording";
    if (item.type === "mirror") return "mirror";
    if (item.type === "translation") return "translation";
    if (item.type === "external_reference") return "reference";
    if (item.type === "profile") return "profile";
    const outgoing = relations.filter((relation) => relation.fromId === item.id);
    if (outgoing.some((relation) => relation.predicate === "implements")) return "implementation";
    if (outgoing.some((relation) => relation.predicate === "part_of")) return "component";
    return "component";
  };

  for (const memberItems of components.values()) {
    const memberIds = new Set(memberItems.map((item) => item.id));
    const forced = curation.forcedEntities.find((definition) =>
      resolveMembers(definition).some((item) => memberIds.has(item.id)),
    );
    const configuredPrimary =
      forced?.primaryLegacyId && itemByLegacyId(items, forced.primaryLegacyId);
    const primary =
      configuredPrimary ||
      [...memberItems].sort(
        (left, right) =>
          primaryPriority.indexOf(left.type) - primaryPriority.indexOf(right.type) ||
          (left.date.start || "").localeCompare(right.date.start || "") ||
          left.id.localeCompare(right.id),
      )[0];
    const kind =
      forced?.kind ||
      (memberItems.some((item) => item.type === "event" || item.type === "recording")
        ? "occurrence"
        : memberItems.some((item) =>
              ["course", "article", "technical_report", "open_source_repo", "producer_credit"].includes(
                item.type,
              ),
            )
          ? "work"
          : "artifact");
    const countability =
      forced?.countability ||
      (kind === "work" || kind === "occurrence"
        ? "unique_work"
        : memberItems.every((item) =>
              ["external_reference", "profile"].includes(item.type),
            )
          ? "context"
          : memberItems.every((item) => ["mirror", "translation"].includes(item.type))
            ? "representation"
            : "unique_work");
    const sourceSnapshots = new Set(
      memberItems.map((item) => item.sourceRecord?.snapshotId),
    );
    const sourceBasis =
      sourceSnapshots.size === 1 &&
      sourceSnapshots.has("snapshot:public-footprint-csv")
        ? "footprint"
        : sourceSnapshots.size === 1
          ? "supplemental"
          : "mixed";
    const prefix = kind === "work" ? "wk" : kind === "occurrence" ? "oc" : "ar";
    const id = forced?.id || `entity:${prefix}-${primary.id.replace(/^item:/, "")}`;
    const slug = forced?.slug || primary.slug;
    const practice =
      forced?.practice ||
      (memberItems.some((item) => item.type === "course")
        ? "teach"
        : memberItems.some((item) => item.type === "event" || item.type === "recording")
          ? "convene"
          : "build");
    const representativeItem =
      primary.date.start
        ? primary
        : [...memberItems]
            .filter((item) => item.date.start)
            .sort(
              (left, right) =>
                (right.date.start || "").localeCompare(left.date.start || "") ||
                left.id.localeCompare(right.id),
            )[0] || primary;
    const itemIds = memberItems.map((item) => item.id).sort();
    const entity = {
      id,
      slug,
      slugAliases: [
        ...new Set(
          memberItems
            .flatMap((item) => [item.slug, ...item.slugAliases])
            .filter((alias) => alias !== slug),
        ),
      ].sort(),
      kind,
      title: primary.title,
      displayTitle: forced?.displayTitle || primary.displayTitle,
      shortTitle: forced?.shortTitle || primary.shortTitle,
      summary: forced?.summary || primary.summary || `${primary.role}.`,
      practice,
      representativeDate: representativeItem.date,
      year: representativeItem.year,
      role: primary.role,
      organizationIds: [...new Set(memberItems.flatMap((item) => item.organizationIds))].sort(),
      topics: [...new Set(memberItems.flatMap((item) => item.topics))].sort(),
      primaryItemId: primary.id,
      itemIds,
      parentEntityIds: [],
      countability,
      sourceBasis,
      childCounts: {
        items: itemIds.length,
        occurrences:
          memberItems.filter((item) => item.type === "event").length ||
          (memberItems.some((item) => item.type === "recording") ? 1 : 0),
        artifacts: memberItems.filter(
          (item) => !["event", "course", "article", "technical_report"].includes(item.type),
        ).length,
      },
      publicationState: "public",
      verificationState: primary.verificationState,
    };
    entities.push(entity);
    for (const item of memberItems) {
      item.canonicalEntityId = entity.id;
      item.entityRole = roleForItem(item, primary.id);
      componentEntityByItemId.set(item.id, entity);
    }
  }

  for (const program of curation.programs) {
    const members = [
      ...(program.memberLegacyIds || []).map((legacyId) => {
        const item = itemByLegacyId(items, legacyId);
        if (!item) throw new Error(`Program member is missing: ${legacyId}`);
        return item;
      }),
      ...items.filter(
        (item) =>
          program.memberFilter &&
          (!program.memberFilter.type || item.type === program.memberFilter.type) &&
          (!program.memberFilter.year || item.year === program.memberFilter.year),
      ),
    ];
    const uniqueMembers = [...new Map(members.map((item) => [item.id, item])).values()];
    const childEntities = [
      ...new Map(
        uniqueMembers.map((item) => [
          componentEntityByItemId.get(item.id).id,
          componentEntityByItemId.get(item.id),
        ]),
      ).values(),
    ];
    for (const child of childEntities) child.parentEntityIds.push(program.id);
    const primary = uniqueMembers[0] || null;
    const organizationIds = [
      ...new Set(uniqueMembers.flatMap((item) => item.organizationIds)),
    ].sort();
    const topics = [...new Set(uniqueMembers.flatMap((item) => item.topics))].sort();
    const programSourceSnapshots = new Set(
      uniqueMembers.map((item) => item.sourceRecord?.snapshotId),
    );
    const sourceBasis =
      uniqueMembers.length === 0
        ? "synthetic"
        : programSourceSnapshots.size === 1 &&
            programSourceSnapshots.has("snapshot:public-footprint-csv")
          ? "footprint"
          : programSourceSnapshots.size === 1
            ? "supplemental"
            : "mixed";
    entities.push({
      id: program.id,
      slug: program.slug,
      slugAliases: [],
      kind: "program",
      title: program.displayTitle,
      displayTitle: program.displayTitle,
      shortTitle: program.shortTitle,
      summary: program.summary,
      practice: program.practice,
      representativeDate: primary?.date || {
        start: program.year ? String(program.year) : null,
        end: null,
        precision: program.year ? "year" : "unknown",
        basis: program.year ? "event_date" : "unknown",
      },
      year: program.year || primary?.year || program.memberFilter?.year || null,
      role: "Program context",
      organizationIds,
      topics,
      primaryItemId: primary?.id || null,
      itemIds: uniqueMembers.map((item) => item.id).sort(),
      parentEntityIds: [],
      countability: "context",
      sourceBasis,
      childCounts: {
        items: uniqueMembers.length,
        occurrences: childEntities.filter((entity) => entity.kind === "occurrence").length,
        artifacts: childEntities.filter((entity) => entity.kind === "artifact").length,
      },
      publicationState: "public",
      verificationState: uniqueMembers.length ? "corroborated" : "tentative",
    });
  }

  for (const entity of entities) {
    entity.parentEntityIds = [...new Set(entity.parentEntityIds)].sort();
  }
  const slugs = countBy(entities, (entity) => entity.slug);
  for (const entity of entities) {
    if (slugs.get(entity.slug) !== 1) {
      throw new Error(`Curation produced duplicate entity slug: ${entity.slug}`);
    }
  }
  return entities.sort((left, right) => left.id.localeCompare(right.id));
}

function workBucketForEntity(entity, itemById) {
  const primary = entity.primaryItemId ? itemById.get(entity.primaryItemId) : null;
  if (primary?.type === "course") return "courses-learning";
  if (
    entity.kind === "occurrence" ||
    ["event", "recording", "producer_credit"].includes(primary?.type)
  ) {
    return "talks-programs";
  }
  if (["article", "technical_report", "translation"].includes(primary?.type)) {
    return "writing-research";
  }
  return "products-open-source";
}

function workGroupPeriod(memberEntities) {
  const dates = memberEntities.map((entity) => entity.representativeDate);
  const starts = dates.map((date) => date.start).filter(Boolean).sort();
  const ends = dates
    .map((date) => date.end || date.start)
    .filter(Boolean)
    .sort();
  const start = starts[0] || null;
  const last = ends.at(-1) || null;
  const end = start && last && start !== last ? last : null;
  const precisions = [...new Set(dates.map((date) => date.precision))];
  const bases = [...new Set(dates.map((date) => date.basis))];
  return {
    start,
    end,
    precision: precisions.length === 1 ? precisions[0] : "unknown",
    basis: bases.length === 1 ? bases[0] : "unknown",
  };
}

function buildWorkGroups(items, entities, manifest) {
  if (manifest.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    throw new Error(`Work-group curation schema must be ${PRESENTATION_SCHEMA_VERSION}`);
  }
  const bucketIds = new Set(manifest.buckets.map((bucket) => bucket.id));
  if (
    bucketIds.size !== WORK_BUCKETS.size ||
    [...WORK_BUCKETS].some((bucket) => !bucketIds.has(bucket))
  ) {
    throw new Error("Work-group curation must define the four approved buckets exactly once");
  }
  const bucketOrder = new Map(
    manifest.buckets.map((bucket) => [bucket.id, bucket.order]),
  );
  const itemById = new Map(items.map((item) => [item.id, item]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const claimedEligibleIds = new Set();
  const claimedExplicitIds = new Set();
  const explicitById = new Map();

  for (const definition of manifest.groups) {
    if (!WORK_BUCKETS.has(definition.bucket)) {
      throw new Error(`Work group ${definition.id} uses an unknown bucket`);
    }
    if (!WORK_GROUPING_DECISIONS.has(definition.decision)) {
      throw new Error(`Work group ${definition.id} uses an unknown grouping decision`);
    }
    if (!definition.roleSummary?.trim()) {
      throw new Error(`Work group ${definition.id} lacks a curated role summary`);
    }
    if (!definition.memberEntityIds.includes(definition.primaryEntityId)) {
      throw new Error(`Work group ${definition.id} does not contain its primary entity`);
    }
    for (const entityId of [
      ...definition.memberEntityIds,
      ...definition.contextEntityIds,
    ]) {
      if (!entityById.has(entityId)) {
        throw new Error(`Work group ${definition.id} has missing entity ${entityId}`);
      }
    }
    for (const entityId of definition.memberEntityIds) {
      if (claimedExplicitIds.has(entityId)) {
        throw new Error(`Entity ${entityId} appears in more than one explicit work group`);
      }
      claimedExplicitIds.add(entityId);
      if (entityById.get(entityId).countability === "unique_work") {
        claimedEligibleIds.add(entityId);
      }
    }
    explicitById.set(definition.id, definition);
  }

  const contextByEntityId = new Map();
  for (const decision of manifest.contextDecisions) {
    if (!WORK_GROUPING_DECISIONS.has(decision.decision)) {
      throw new Error(`Context decision ${decision.id} uses an unknown decision`);
    }
    for (const entityId of [...decision.entityIds, ...decision.contextEntityIds]) {
      if (!entityById.has(entityId)) {
        throw new Error(`Context decision ${decision.id} has missing entity ${entityId}`);
      }
    }
    for (const entityId of decision.entityIds) {
      const current = contextByEntityId.get(entityId) || [];
      current.push(...decision.contextEntityIds);
      contextByEntityId.set(entityId, current);
    }
  }

  const definitions = [
    ...manifest.groups,
    ...entities
      .filter(
        (entity) =>
          entity.publicationState === "public" &&
          entity.countability === "unique_work" &&
          !claimedEligibleIds.has(entity.id),
      )
      .map((entity) => ({
        id: `group:standalone:${entity.id.replace(/^entity:/, "")}`,
        slug: entity.slug,
        title: entity.displayTitle,
        shortTitle: entity.shortTitle,
        summary: entity.summary,
        roleSummary: entity.role,
        bucket: workBucketForEntity(entity, itemById),
        featuredOrder: null,
        primaryEntityId: entity.id,
        memberEntityIds: [entity.id],
        contextEntityIds: [],
        decision: "standalone",
        rationale: "No reviewed evidence supports merging this entity with another work.",
      })),
  ];

  const groups = definitions.map((definition) => {
    const memberEntities = definition.memberEntityIds.map((id) => entityById.get(id));
    const itemIds = [
      ...new Set(memberEntities.flatMap((entity) => entity.itemIds)),
    ].sort();
    const memberItems = itemIds.map((id) => itemById.get(id));
    const period = workGroupPeriod(memberEntities);
    const parentContexts = memberEntities.flatMap((entity) => entity.parentEntityIds);
    const decisionContexts = memberEntities.flatMap(
      (entity) => contextByEntityId.get(entity.id) || [],
    );
    const relatedContextEntityIds = [
      ...new Set([
        ...definition.contextEntityIds,
        ...parentContexts,
        ...decisionContexts,
      ]),
    ]
      .filter((id) => !definition.memberEntityIds.includes(id))
      .sort();
    const programEntityIds = relatedContextEntityIds.filter(
      (id) => entityById.get(id).kind === "program",
    );
    const contextEntityIds = relatedContextEntityIds.filter(
      (id) => entityById.get(id).kind !== "program",
    );
    const years = [period.start, period.end || period.start]
      .filter(Boolean)
      .map((value) => Number(value.slice(0, 4)))
      .filter(Number.isFinite);
    const verificationState = memberEntities.some(
      (entity) => entity.verificationState === "tentative",
    )
      ? "tentative"
      : memberEntities.every((entity) => entity.verificationState === "verified")
        ? "verified"
        : "corroborated";
    return {
      id: definition.id,
      slug: definition.slug,
      slugAliases: [
        ...new Set(
          memberEntities
            .flatMap((entity) => [entity.slug, ...entity.slugAliases])
            .filter((slug) => slug !== definition.slug),
        ),
      ].sort(),
      title: definition.title,
      shortTitle: definition.shortTitle,
      summary: definition.summary,
      roleSummary: definition.roleSummary,
      bucket: definition.bucket,
      featuredOrder: definition.featuredOrder,
      primaryEntityId: definition.primaryEntityId,
      memberEntityIds: [...new Set(definition.memberEntityIds)].sort(),
      programEntityIds,
      contextEntityIds,
      itemIds,
      period,
      yearStart: years.length ? Math.min(...years) : null,
      yearEnd: years.length ? Math.max(...years) : null,
      organizationIds: [
        ...new Set(memberEntities.flatMap((entity) => entity.organizationIds)),
      ].sort(),
      topics: [...new Set(memberEntities.flatMap((entity) => entity.topics))].sort(),
      formats: [...new Set(memberItems.map((item) => item.type))].sort(
        (left, right) => TYPE_ORDER.indexOf(left) - TYPE_ORDER.indexOf(right),
      ),
      publicationState: "public",
      verificationState,
    };
  });

  const eligibleIds = entities
    .filter(
      (entity) =>
        entity.publicationState === "public" &&
        entity.countability === "unique_work",
    )
    .map((entity) => entity.id);
  const memberCounts = countBy(
    groups.flatMap((group) => group.memberEntityIds),
    (id) => id,
  );
  for (const entityId of eligibleIds) {
    if (memberCounts.get(entityId) !== 1) {
      throw new Error(
        `Eligible entity ${entityId} must belong to exactly one WorkGroup`,
      );
    }
  }
  const groupSlugs = countBy(groups, (group) => group.slug);
  for (const group of groups) {
    if (groupSlugs.get(group.slug) !== 1) {
      throw new Error(`Duplicate WorkGroup slug: ${group.slug}`);
    }
  }
  for (const bucket of WORK_BUCKETS) {
    const featured = groups
      .filter((group) => group.bucket === bucket && group.featuredOrder !== null)
      .map((group) => group.featuredOrder)
      .sort((left, right) => left - right);
    if (featured.join(",") !== "1,2,3") {
      throw new Error(`WorkGroup bucket ${bucket} must have featured order 1,2,3`);
    }
  }

  return groups.sort(
    (left, right) =>
      bucketOrder.get(left.bucket) - bucketOrder.get(right.bucket) ||
      (left.featuredOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.featuredOrder ?? Number.MAX_SAFE_INTEGER) ||
      (right.period.start || "").localeCompare(left.period.start || "") ||
      left.title.localeCompare(right.title),
  );
}

function buildGroupingLedger(
  items,
  entities,
  workGroups,
  manifest,
  footprintRows,
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const groupByEntityId = new Map(
    workGroups.flatMap((group) =>
      group.memberEntityIds.map((entityId) => [entityId, group]),
    ),
  );
  const definitionById = new Map(
    manifest.groups.map((definition) => [definition.id, definition]),
  );
  const entries = workGroups.map((group) => {
    const definition = definitionById.get(group.id);
    return {
      id: `ledger:work-group:${group.id.replace(/^group:/, "").replaceAll(":", "-")}`,
      workGroupId: group.id,
      decision: definition?.decision || "standalone",
      rule: definition ? "explicit_curation" : "deterministic_standalone",
      entityIds: group.memberEntityIds,
      contextEntityIds: [
        ...new Set([...group.programEntityIds, ...group.contextEntityIds]),
      ].sort(),
      itemIds: group.itemIds,
      rationale:
        definition?.rationale ||
        "No reviewed relation or curation override supports a broader grouping.",
    };
  });

  for (const entity of entities) {
    const memberItems = entity.itemIds.map((id) => itemById.get(id));
    if (
      memberItems.length < 2 ||
      !memberItems.some((item) =>
        ["recording", "mirror", "translation"].includes(item.entityRole),
      )
    ) {
      continue;
    }
    entries.push({
      id: `ledger:representation:${entity.id.replace(/^entity:/, "")}`,
      workGroupId: groupByEntityId.get(entity.id)?.id || null,
      decision: "same_occurrence_representation",
      rule: "typed_relation",
      entityIds: [entity.id],
      contextEntityIds: [],
      itemIds: entity.itemIds,
      rationale:
        "Typed recording, mirror, or translation relations preserve distinct public forms under one canonical entity.",
    });
  }

  for (const decision of manifest.contextDecisions) {
    const targetGroups = [
      ...new Set(
        decision.entityIds
          .map((entityId) => groupByEntityId.get(entityId)?.id)
          .filter(Boolean),
      ),
    ];
    entries.push({
      id: decision.id,
      workGroupId: targetGroups.length === 1 ? targetGroups[0] : null,
      decision: decision.decision,
      rule: "explicit_curation",
      entityIds: [...decision.entityIds].sort(),
      contextEntityIds: [...decision.contextEntityIds].sort(),
      itemIds: [
        ...new Set(
          [...decision.entityIds, ...decision.contextEntityIds].flatMap(
            (entityId) => entityById.get(entityId).itemIds,
          ),
        ),
      ].sort(),
      rationale: decision.rationale,
    });
  }

  const classifiedContextIds = new Set(
    entries.flatMap((entry) => entry.contextEntityIds),
  );
  const memberEntityIds = new Set(
    workGroups.flatMap((group) => group.memberEntityIds),
  );
  for (const entity of entities) {
    if (memberEntityIds.has(entity.id) || classifiedContextIds.has(entity.id)) {
      continue;
    }
    entries.push({
      id: `ledger:context:${entity.id.replace(/^entity:/, "")}`,
      workGroupId: null,
      decision: "reference_only",
      rule: "context_classification",
      entityIds: [entity.id],
      contextEntityIds: [],
      itemIds: entity.itemIds,
      rationale:
        "This entity is retained as program, profile, citation, or representation context and is not a standalone public work.",
    });
  }

  const repeatedTitleClusterCount = [
    ...countBy(footprintRows, (row) => normalizedTitle(row.title)).values(),
  ].filter((count) => count > 1).length;
  const urls = footprintRows.flatMap((row) =>
    [row.primary_url, row.secondary_url].filter(Boolean),
  );
  const repeatedUrlClusterCount = [
    ...countBy(urls, normalizeUrl).values(),
  ].filter((count) => count > 1).length;
  return {
    schemaVersion: "1.0",
    repeatedTitleClusterCount,
    repeatedUrlClusterCount,
    entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function buildMetricGroups(publicMetrics, presentation) {
  if (presentation.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    throw new Error(`Metric presentation schema must be ${PRESENTATION_SCHEMA_VERSION}`);
  }
  const metricIds = new Set(publicMetrics.map((metric) => metric.id));
  const groups = presentation.groups.map((definition) => {
    if (!METRIC_THEMES.has(definition.theme)) {
      throw new Error(`Metric group ${definition.id} uses an unknown theme`);
    }
    for (const metricId of definition.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Metric group ${definition.id} has missing metric ${metricId}`);
      }
    }
    if (!metricIds.has(definition.leadMetricId)) {
      throw new Error(`Metric group ${definition.id} has missing lead metric`);
    }
    return {
      ...definition,
      metricIds: [...definition.metricIds],
    };
  });
  const orders = groups.map((group) => group.order);
  if (new Set(orders).size !== groups.length) {
    throw new Error("Metric presentation group order must be unique");
  }
  return groups.sort((left, right) => left.order - right.order);
}

function parseMarkdownSections(markdown, sourceKey, publicationState) {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;
    const title = match[1].trim();
    return {
      id: `narrative:owner:${sourceKey}:${slugify(title)}`,
      title,
      body: markdown.slice(bodyStart, bodyEnd).trim(),
      placement: "owner_archive",
      publicationState,
      sourceSnapshotId: `snapshot:${sourceKey}-markdown`,
    };
  });
}

function normalizeRecordedDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  return null;
}

function metricPeriod(period, recordedAt) {
  const range = period.match(/^(\d{4}(?:-\d{2})?(?:-\d{2})?)\.\.(\d{4}(?:-\d{2})?(?:-\d{2})?)$/);
  return {
    start: range?.[1] || null,
    end: range?.[2] || null,
    asOf: normalizeRecordedDate(recordedAt),
    label: period,
  };
}

function parseMetricValue(value, unit) {
  if (unit === "boolean") return value === "1";
  if (unit === "date") return value;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function metricVerification(row) {
  return row.confidence === "high" ? "verified" : "tentative";
}

function itemByTitle(items, title, type) {
  return items.find(
    (item) => item.title.toLowerCase() === title.toLowerCase() && (!type || item.type === type),
  );
}

function resolveMetricSubject(row, items, entities, curation) {
  const override = curation.metricSubjectOverrides.find(
    (candidate) =>
      candidate.item === row.item &&
      (!candidate.metric || candidate.metric === row.metric),
  );
  if (override) {
    const subjectId =
      override.subjectEntityId ||
      itemByLegacyId(items, override.subjectLegacyId)?.canonicalEntityId;
    if (!subjectId || !entities.some((entity) => entity.id === subjectId)) {
      throw new Error(`Metric subject override is unresolved: ${row.item} / ${row.metric}`);
    }
    return {
      subjectId,
      scope: override.scope,
      attribution: override.attribution,
    };
  }
  const exact = itemByTitle(items, row.item);
  if (exact) {
    const entity = entities.find((candidate) => candidate.id === exact.canonicalEntityId);
    return {
      subjectId: entity.id,
      scope: entity.kind === "occurrence" ? "occurrence" : entity.kind === "work" ? "work" : "item",
      attribution: "direct",
    };
  }
  if (row.item === "W&B MCP Server") {
    return { subjectId: "entity:wk-0001", scope: "work", attribution: "direct" };
  }
  if (row.item === "W&B MCP Server GA launch") {
    return { subjectId: "entity:wk-0001", scope: "work", attribution: "direct" };
  }
  if (/all 3 anish courses/i.test(row.item)) {
    return { subjectId: "collection:courses", scope: "collection", attribution: "contextual" };
  }
  if (/public recordings/i.test(row.item)) {
    return { subjectId: "collection:recordings", scope: "collection", attribution: "contextual" };
  }
  if (/public event|all .*events|events count/i.test(row.item)) {
    return { subjectId: "collection:events", scope: "collection", attribution: "contextual" };
  }
  return {
    subjectId: `collection:${row.category}`,
    scope: "collection",
    attribution: "contextual",
  };
}

function titleFromMetricKey(key) {
  return key
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function buildOwnerMetrics(rows, items, entities, curation, ownerEvidence, capturedAt) {
  const metrics = [];
  const evidenceById = new Map(ownerEvidence.map((evidence) => [evidence.id, evidence]));

  rows.forEach((row, index) => {
    const access =
      row.source_system === "public_footprint"
        ? /^https?:\/\//i.test(row.source_url)
          ? "public_web"
          : "owner_private"
        : "company_internal";
    const evidenceFingerprint = row.source_url || `${row.source_system}:${row.source_name}`;
    const evidenceId = `evidence:${access === "public_web" ? "web" : "internal"}:${shortHash(
      evidenceFingerprint,
    )}`;
    if (!evidenceById.has(evidenceId)) {
      const evidence = {
        id: evidenceId,
        title: row.source_name || titleFromMetricKey(row.source_system),
        kind: access === "public_web" ? "web_page" : "internal_record",
        access,
        ...(row.source_url ? { url: row.source_url } : {}),
        publisher: row.source_system,
        capturedAt: normalizeRecordedDate(row.date_recorded) || capturedAt,
        verificationState: metricVerification(row),
      };
      evidenceById.set(evidenceId, evidence);
      ownerEvidence.push(evidence);
    }

    const fingerprint = sha256(
      [row.category, row.item, row.metric, row.period, row.date_recorded, row.source_url].join("\u001f"),
    );
    const subject = resolveMetricSubject(row, items, entities, curation);
    metrics.push({
      id: `metric:source:${slugify(row.category)}:${slugify(row.item)}:${slugify(
        row.metric,
      )}:${slugify(row.date_recorded)}:${shortHash(row.period, 8)}`,
      subjectId: subject.subjectId,
      category: row.category,
      key: row.metric,
      label: `${row.item} — ${titleFromMetricKey(row.metric)}`,
      qualifier: row.notes || null,
      period: metricPeriod(row.period, row.date_recorded),
      sourceLabel: row.source_name || titleFromMetricKey(row.source_system),
      scope: subject.scope,
      attribution: subject.attribution,
      displaySurfaces: [],
      publicationState: row.source_system === "public_footprint" ? "public" : "private",
      verificationState: metricVerification(row),
      value: parseMetricValue(row.value, row.unit),
      unit: row.unit,
      evidenceIds: [evidenceId],
      sourceRecord: {
        snapshotId: "snapshot:impact-csv",
        row: index + 2,
        fingerprint,
      },
    });
  });

  ownerEvidence.sort((left, right) => left.id.localeCompare(right.id));
  return metrics.sort((left, right) => left.id.localeCompare(right.id));
}

function selectImpactRows(rows, selectors) {
  return selectors.map((selector) => {
    const matches = rows.filter(
      (row) =>
        row.item === selector.item &&
        row.metric === selector.metric &&
        (!selector.date || row.date_recorded === selector.date),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Public claim selector ${selector.item}/${selector.metric}/${selector.date || "*"} matched ${
          matches.length
        } rows`,
      );
    }
    return matches[0];
  });
}

function buildPublicMetrics(impactRows, items, entities, claimUpgrades) {
  const internalEvidence = ["evidence:methodology:internal-analytics"];
  const publicEvidence = ["evidence:methodology:public-footprint"];
  const courseCollection = "collection:courses";
  const courseCurriculumGroup = "group:courses:ai-curriculum";
  const eventCollection = "collection:events";
  const evalsEntityId =
    itemByTitle(items, "LLM Apps: Evaluation", "course")?.canonicalEntityId || courseCollection;
  const mcpId = "entity:wk-0001";
  if (!entities.some((entity) => entity.id === mcpId)) {
    throw new Error("Curated MCP work entity is missing");
  }

  const definitions = [
    {
      id: "metric:courses:enrollments:2026-07-30",
      subjectId: courseCurriculumGroup,
      category: "courses",
      key: "course_enrollments",
      displayValue: "7K+",
      label: "course enrollments across three AI courses",
      qualifier: "Enrollments, not unique learners.",
      period: { start: "2024-06", end: "2026-07", asOf: "2026-07-30", label: "2024–2026" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "homepage", "collection", "sources"],
      selectors: [{ item: "All 3 Anish courses", metric: "enrollments_total" }],
    },
    {
      id: "metric:courses:same-day-account-share:2026-07-30",
      subjectId: courseCurriculumGroup,
      category: "courses",
      key: "same_day_account_creation_share",
      displayValue: "About half",
      label: "of course enrollments accompanied a W&B account created the same day",
      qualifier: "An observed same-day association, not a causal conversion claim.",
      period: { start: "2024-06", end: "2026-07", asOf: "2026-07-30", label: "2024–2026" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "collection", "sources"],
      selectors: [
        { item: "All 3 Anish courses", metric: "enrollments_total" },
        { item: "All 3 Anish courses", metric: "course_sourced_wandb_signups" },
      ],
    },
    {
      id: "metric:course:llm-apps-evaluation:launch-signups:2025-01-10",
      subjectId: evalsEntityId,
      category: "courses",
      key: "launch_signups",
      displayValue: "1K+",
      label: "Evals-course signups in roughly 36 hours",
      qualifier: "Rounded down from the internal launch checkpoint.",
      period: { start: "2025-01-08", end: "2025-01-10", asOf: "2025-01-10", label: "~36 hours" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "collection", "sources"],
      selectors: [
        {
          item: "LLM Apps: Evaluation",
          metric: "launch_signups_first_36_hours",
          date: "2025-01-10",
        },
      ],
    },
    {
      id: "metric:project:wandb-mcp-server:tool-calls:2026-06-11",
      subjectId: mcpId,
      category: "product",
      key: "mcp_tool_calls",
      displayValue: "Nearly 100K",
      label: "MCP tool calls in its first few months",
      qualifier: "Historical launch-period snapshot; later usage is intentionally not substituted.",
      period: { start: "2026-03", end: "2026-06-11", asOf: "2026-06-11", label: "First few months" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "homepage", "collection", "sources"],
      selectors: [
        { item: "W&B MCP Server", metric: "all_time_tool_calls", date: "2026-06-11" },
      ],
    },
    {
      id: "metric:project:wandb-mcp-server:audience:2026-06-11",
      subjectId: mcpId,
      category: "product",
      key: "mcp_users_and_organizations",
      displayValue: "1K+",
      label: "MCP users across 1K+ organizations",
      qualifier: "Rounded launch-period adoption snapshot.",
      period: { start: "2026-03", end: "2026-06-11", asOf: "2026-06-11", label: "Launch period" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "collection", "sources"],
      selectors: [
        { item: "W&B MCP Server", metric: "unique_users", date: "2026-06-11" },
        { item: "W&B MCP Server", metric: "unique_orgs", date: "2026-06-11" },
      ],
    },
    {
      id: "metric:project:wandb-mcp-server:returning-share:2026-06-11",
      subjectId: mcpId,
      category: "product",
      key: "returning_user_share",
      displayValue: "More than two-thirds",
      label: "of weekly active MCP users were returning users",
      qualifier: "Weekly active-user composition at the cited checkpoint.",
      period: { start: null, end: null, asOf: "2026-06-11", label: "Week of 2026-06-07" },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "collection", "sources"],
      selectors: [
        { item: "W&B MCP Server", metric: "returning_user_share_of_wau", date: "2026-06-11" },
      ],
    },
    {
      id: "metric:project:wandb-mcp-server:weekly-reengaged:2026-07-28",
      subjectId: mcpId,
      category: "product",
      key: "weekly_reengaged_users",
      displayValue: "Hundreds",
      label: "of MCP users re-engaged in a week",
      qualifier: "Rounded weekly re-engagement checkpoint.",
      period: {
        start: "2026-07-20",
        end: "2026-07-26",
        asOf: "2026-07-28",
        label: "Week of 2026-07-20",
      },
      scope: "work",
      attribution: "direct",
      displaySurfaces: ["item_detail", "collection", "sources"],
      selectors: [
        { item: "W&B MCP Server", metric: "weekly_reengaged_users", date: "2026-07-28" },
      ],
    },
    {
      id: "metric:events:pipeline-supported:2025",
      subjectId: "entity:pg-0007",
      category: "events",
      key: "pipeline_supported",
      displayValue: "$2M+",
      label: "in pipeline supported by 2025 event programs",
      qualifier: "Program-supported pipeline, not generated revenue or individual ARR attribution.",
      period: { start: "2025", end: "2025", asOf: "2025-10-01", label: "2025" },
      scope: "program",
      attribution: "associated",
      displaySurfaces: ["homepage", "collection", "sources"],
      selectors: [
        {
          item: "All 2025 events (Anish core IC/organizer)",
          metric: "pipeline_supported_usd",
        },
      ],
    },
    {
      id: "metric:events:ic-associated-pipeline:2024",
      subjectId: "entity:pg-0008",
      category: "events",
      key: "ic_associated_pipeline",
      displayValue: "$300K+",
      label: "in 2024 event pipeline associated with work where Anish was the IC",
      qualifier: "Association from an internal tracking split; warehouse data has no person-level mapping.",
      period: { start: "2024", end: "2024", asOf: "2025-01-01", label: "2024" },
      scope: "program",
      attribution: "associated",
      displaySurfaces: ["collection", "sources"],
      verificationState: "tentative",
      selectors: [
        { item: "2024 events where Anish was IC", metric: "pipeline_supported_usd" },
      ],
    },
    {
      id: "metric:event:nvidia-gtc:leads:2024",
      subjectId: "entity:pg-0005",
      category: "events",
      key: "gtc_leads",
      displayValue: "500+",
      label: "leads from NVIDIA GTC 2024",
      qualifier: "Program reach, not individual attribution.",
      period: {
        start: "2024-03-18",
        end: "2024-03-21",
        asOf: "2024-04-01",
        label: "NVIDIA GTC 2024",
      },
      scope: "program",
      attribution: "contextual",
      displaySurfaces: ["collection", "sources"],
      selectors: [{ item: "NVIDIA GTC 2024", metric: "leads" }],
    },
    {
      id: "metric:event:fully-connected-sf:reach:2024",
      subjectId: "entity:pg-0006",
      category: "events",
      key: "fully_connected_reach",
      displayValue: "1K+ / 500+",
      label: "registrants / attendees at Fully Connected SF",
      qualifier: "Flagship-event program reach, not individual attribution.",
      period: {
        start: "2024-04-18",
        end: "2024-04-18",
        asOf: "2024-04-30",
        label: "Fully Connected SF 2024",
      },
      scope: "program",
      attribution: "contextual",
      displaySurfaces: ["collection", "sources"],
      selectors: [
        { item: "Fully Connected SF 2024", metric: "registrants" },
        { item: "Fully Connected SF 2024", metric: "attendees" },
      ],
    },
    {
      id: "metric:archive:event-references:2026-07",
      subjectId: eventCollection,
      category: "archive",
      key: "event_references",
      displayValue: "49",
      label: "dated public event and session references",
      qualifier: "Unique inventory rows; recordings and mirrors are counted separately.",
      period: { start: "2021", end: "2026", asOf: "2026-07-30", label: "2021–2026" },
      scope: "collection",
      attribution: "contextual",
      displaySurfaces: ["collection", "sources"],
      sourceLabel: "Public footprint inventory",
      publicEvidenceIds: publicEvidence,
      verificationState: "derived",
      selectors: [
        {
          item: "Public event/session references 2021-2026",
          metric: "public_event_references",
        },
      ],
    },
    {
      id: "metric:archive:recording-hours:2026-07",
      subjectId: "collection:recordings",
      category: "archive",
      key: "recording_hours",
      displayValue: "19+",
      label: "hours of public talks and interviews",
      qualifier: "Derived from 23 unique recording durations; mirrors and excerpts are excluded.",
      period: { start: "2021", end: "2026", asOf: "2026-07-30", label: "2021–2026" },
      scope: "collection",
      attribution: "contextual",
      displaySurfaces: ["collection", "sources"],
      sourceLabel: "Public footprint inventory",
      publicEvidenceIds: publicEvidence,
      verificationState: "derived",
      selectors: [{ item: "Public recordings 2021-2026", metric: "unique_recordings" }],
    },
  ];

  if (claimUpgrades.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    throw new Error(`Public claim-upgrade schema must be ${PRESENTATION_SCHEMA_VERSION}`);
  }
  for (const replacement of claimUpgrades.claims) {
    const index = definitions.findIndex(
      (definition) => definition.id === replacement.replacesMetricId,
    );
    if (index < 0 || replacement.publicationState !== "public") {
      throw new Error(`Public claim replacement ${replacement.id} is unresolved`);
    }
    if (
      replacement.key.includes("tool_calls") &&
      replacement.displayValue.includes("$")
    ) {
      throw new Error(`Tool-call public claim ${replacement.id} cannot use currency formatting`);
    }
    definitions.splice(index, 1, replacement);
  }

  return definitions.map((definition) => {
    selectImpactRows(impactRows, definition.selectors);
    if (!APPROVED_PUBLIC_DISPLAYS.has(definition.displayValue)) {
      throw new Error(`Unapproved public display value: ${definition.displayValue}`);
    }
    const verificationState = definition.verificationState || "corroborated";
    const sourceLabel = definition.sourceLabel || "Internal analytics";
    const publicEvidenceIds = definition.publicEvidenceIds || internalEvidence;
    const safe = { ...definition };
    delete safe.selectors;
    delete safe.verificationState;
    delete safe.sourceLabel;
    delete safe.publicEvidenceIds;
    delete safe.replacesMetricId;
    delete safe.publicationState;
    return {
      ...safe,
      sourceLabel,
      publicationState: "public",
      verificationState,
      publicEvidenceIds,
    };
  });
}

function makeCollection(id, title, description, itemIds = [], metricIds = []) {
  return {
    id,
    title,
    description,
    itemIds: [...new Set(itemIds)],
    metricIds: [...new Set(metricIds)],
  };
}

function itemsOfType(items, ...types) {
  return items.filter((item) => types.includes(item.type)).map((item) => item.id);
}

function buildCollections(items, publicMetrics) {
  const representativeTitles = [
    ["course", "LLM Apps: Evaluation"],
    ["course", "AI Engineering: Agents"],
    ["course", "Developer's Guide to LLM Prompting"],
    [
      "article",
      "Introducing the W&B MCP Server: An Agent-Native Interface for Your Experiments and Traces",
    ],
    ["open_source_repo", "wandb-mcp-server"],
    ["event", "Mastering MLOps with W&B and Microsoft Phi-2"],
    ["event", "Accelerate GenAI Application Development with W&B Weave and NVIDIA — EXS74222"],
    ["recording", "Evaluating and Integrating ML Models — MLOps Podcast #213"],
  ];
  const selectedIds = representativeTitles
    .map(([type, title]) => itemByTitle(items, title, type)?.id)
    .filter(Boolean);
  const collections = [
    makeCollection(
      "collection:selected-work",
      "Selected work",
      "A compact path through teaching, building, and convening.",
      selectedIds,
      [],
    ),
    makeCollection(
      "collection:courses",
      "Courses",
      "Public AI courses taught or produced by Anish.",
      itemsOfType(items, "course"),
      publicMetrics.filter((metric) => metric.category === "courses").map((metric) => metric.id),
    ),
    makeCollection(
      "collection:events",
      "Events and talks",
      "Dated public sessions, talks, workshops, and conferences.",
      itemsOfType(items, "event"),
      publicMetrics
        .filter((metric) => metric.category === "events" || metric.key === "event_references")
        .map((metric) => metric.id),
    ),
    makeCollection(
      "collection:recordings",
      "Recordings",
      "Distinct public talks and interviews; mirrors are related, not double-counted.",
      itemsOfType(items, "recording"),
      publicMetrics.filter((metric) => metric.key === "recording_hours").map((metric) => metric.id),
    ),
    makeCollection(
      "collection:content",
      "Writing and technical reports",
      "Articles, reports, translations, and production credits.",
      itemsOfType(items, "article", "technical_report", "translation", "producer_credit"),
      [],
    ),
    makeCollection(
      "collection:product",
      "Product and engineering",
      "Open-source projects and implementation work.",
      itemsOfType(items, "open_source_repo", "open_source_pr"),
      publicMetrics.filter((metric) => metric.category === "product").map((metric) => metric.id),
    ),
    makeCollection(
      "collection:community",
      "Community and teaching",
      "Public community, academic, and education references.",
      items
        .filter((item) => item.topics.includes("community") || item.topics.includes("education"))
        .map((item) => item.id),
      [],
    ),
    makeCollection("collection:customer", "Customer work", "Owner-only metric subject.", [], []),
    makeCollection("collection:career", "Career", "Owner-only metric subject.", [], []),
  ];
  return collections.sort((left, right) => left.id.localeCompare(right.id));
}

function buildProfile(items) {
  const links = items
    .filter((item) => item.type === "profile")
    .map((item) => ({
      label: item.title.replace(/^Anish Shah — /, "").replace(/^ash?0ts — /, ""),
      href: item.urls.find((entry) => entry.kind === "primary")?.url,
    }))
    .filter((link) => link.href);
  return {
    id: "person:anish-shah",
    name: "Anish Shah",
    headline: "Applied AI builder, educator, and technical storyteller at Weights & Biases",
    summary:
      "Anish turns emerging AI systems into products, courses, field programs, and public technical artifacts people can inspect and use.",
    primaryCta: { label: "Explore my work", href: "/work" },
    links,
  };
}

function buildPublicNarratives() {
  return [
    {
      id: "narrative:home:thesis",
      title: "Proof travels with the claim",
      body: "Applied AI is most useful when the work, outcome, time window, and evidence can be followed together.",
      placement: "home",
      publicationState: "public",
    },
    {
      id: "narrative:work:teach",
      title: "Teach",
      body: "Build practical learning systems that help people move from AI concepts to working evaluations, prompts, and agents.",
      placement: "work",
      publicationState: "public",
    },
    {
      id: "narrative:work:build",
      title: "Build",
      body: "Ship product surfaces and open-source infrastructure that make experimental AI workflows easier to operate.",
      placement: "work",
      publicationState: "public",
    },
    {
      id: "narrative:work:convene",
      title: "Convene",
      body: "Create technical programs where practitioners can learn, test ideas, and connect work to measurable program outcomes.",
      placement: "work",
      publicationState: "public",
    },
    {
      id: "narrative:play:personal-streams",
      title: "Outside the work",
      body: "Complete, sanitized collection snapshots reveal patterns across anime, books, and games; a page-sized gallery makes every public title explorable. Movement stays inside an official Strava embed loaded only after visitor intent.",
      placement: "play",
      publicationState: "public",
    },
    {
      id: "narrative:sources:method",
      title: "How to read the numbers",
      body: "Public counts come from the public inventory. Internal outcomes are deliberately rounded, dated, qualified, and separated from revenue or individual-causality claims.",
      placement: "sources",
      publicationState: "public",
    },
  ];
}

function stripPrivateItemFields(item) {
  const publicItem = { ...item };
  delete publicItem.sourceRecord;
  return publicItem;
}

function markFeatured(items, collection) {
  const selected = new Set(collection.itemIds);
  for (const item of items) item.featured = selected.has(item.id);
}

function sourceSnapshot({
  id,
  label,
  content,
  capturedAt,
  rowCount = null,
  sectionCount = null,
  access,
  sourceFile,
}) {
  return {
    id,
    label,
    capturedAt,
    rowCount,
    sectionCount,
    sha256: sha256(content),
    access,
    sourceFile,
  };
}

function buildJsonSchema() {
  const publicationState = {
    type: "string",
    enum: ["public", "review_required", "private", "excluded"],
  };
  const verificationState = {
    type: "string",
    enum: [
      "verified",
      "corroborated",
      "listed_unconfirmed",
      "derived",
      "tentative",
      "superseded",
      "excluded",
    ],
  };
  const contentDate = {
    type: "object",
    additionalProperties: false,
    required: ["start", "end", "precision", "basis"],
    properties: {
      start: { type: ["string", "null"] },
      end: { type: ["string", "null"] },
      precision: { enum: ["day", "month", "year", "unknown"] },
      basis: { enum: ["event_date", "publication_date", "upload_date", "unknown"] },
    },
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://anishshah.dev/schema/anish-content.v1.2.json",
    title: "Anish Shah Content Bundle",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "contentVersion",
      "generatedAt",
      "sourceSummary",
      "profile",
      "organizations",
      "items",
      "entities",
      "workGroups",
      "metrics",
      "metricGroups",
      "evidence",
      "relations",
      "collections",
      "narratives",
      "sourceSnapshots",
    ],
    properties: {
      schemaVersion: { const: "1.2" },
      contentVersion: { type: "string", pattern: "^[a-f0-9]{16}$" },
      generatedAt: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$",
      },
      sourceSummary: { $ref: "#/$defs/sourceSummary" },
      profile: { $ref: "#/$defs/profile" },
      organizations: { type: "array", items: { $ref: "#/$defs/organization" } },
      items: { type: "array", items: { $ref: "#/$defs/item" } },
      entities: { type: "array", items: { $ref: "#/$defs/entity" } },
      workGroups: { type: "array", items: { $ref: "#/$defs/workGroup" } },
      metrics: { type: "array", items: { $ref: "#/$defs/metric" } },
      metricGroups: {
        type: "array",
        items: { $ref: "#/$defs/metricPresentationGroup" },
      },
      evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
      relations: { type: "array", items: { $ref: "#/$defs/relation" } },
      collections: { type: "array", items: { $ref: "#/$defs/collection" } },
      narratives: { type: "array", items: { $ref: "#/$defs/narrative" } },
      sourceSnapshots: { type: "array", items: { $ref: "#/$defs/sourceSnapshot" } },
      groupingLedger: { $ref: "#/$defs/groupingLedger" },
    },
    $defs: {
      sourceSummary: {
        type: "object",
        additionalProperties: false,
        required: [
          "footprintRows",
          "impactRows",
          "supplementalArtifacts",
          "publicItems",
          "approvedMetricCount",
          "footprintBackedUniqueWorks",
          "supplementalUniqueWorks",
        ],
        properties: {
          footprintRows: { type: "integer", minimum: 0 },
          impactRows: { type: "integer", minimum: 0 },
          supplementalArtifacts: { type: "integer", minimum: 0 },
          publicItems: { type: "integer", minimum: 0 },
          approvedMetricCount: { type: "integer", minimum: 0 },
          footprintBackedUniqueWorks: { type: "integer", minimum: 0 },
          supplementalUniqueWorks: { type: "integer", minimum: 0 },
        },
      },
      profile: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "headline", "summary", "primaryCta", "links"],
        properties: {
          id: { const: "person:anish-shah" },
          name: { type: "string" },
          headline: { type: "string" },
          summary: { type: "string" },
          primaryCta: { $ref: "#/$defs/link" },
          links: { type: "array", items: { $ref: "#/$defs/link" } },
        },
      },
      link: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          href: { type: "string" },
        },
      },
      organization: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
      contentDate,
      sourceRecord: {
        type: "object",
        additionalProperties: false,
        required: ["snapshotId", "row", "fingerprint"],
        properties: {
          snapshotId: { type: "string" },
          row: { type: "integer", minimum: 2 },
          fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      },
      item: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "legacyIds",
          "slug",
          "slugAliases",
          "type",
          "title",
          "displayTitle",
          "shortTitle",
          "date",
          "additionalDates",
          "year",
          "role",
          "organizationIds",
          "location",
          "status",
          "urls",
          "summary",
          "topics",
          "durationSeconds",
          "publicationState",
          "verificationState",
          "evidenceIds",
          "featured",
          "canonicalEntityId",
          "entityRole",
        ],
        properties: {
          id: { type: "string" },
          legacyIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          slug: { type: "string" },
          slugAliases: { type: "array", items: { type: "string" }, uniqueItems: true },
          type: {
            enum: [
              "event",
              "article",
              "course",
              "recording",
              "technical_report",
              "external_reference",
              "producer_credit",
              "translation",
              "mirror",
              "profile",
              "open_source_repo",
              "open_source_pr",
            ],
          },
          title: { type: "string" },
          displayTitle: { type: "string" },
          shortTitle: { type: "string" },
          date: contentDate,
          additionalDates: {
            type: "array",
            items: { $ref: "#/$defs/additionalContentDate" },
          },
          year: { type: ["integer", "null"] },
          role: { type: "string" },
          organizationIds: { type: "array", items: { type: "string" } },
          location: {
            type: "object",
            additionalProperties: false,
            required: ["label", "kind"],
            properties: {
              label: { type: "string" },
              kind: { enum: ["online", "physical", "hybrid", "platform", "unknown"] },
            },
          },
          status: { type: "string" },
          urls: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "url"],
              properties: {
                kind: { enum: ["primary", "secondary"] },
                url: { type: "string", pattern: "^https?://" },
              },
            },
          },
          summary: { type: ["string", "null"] },
          topics: { type: "array", items: { type: "string" }, uniqueItems: true },
          durationSeconds: { type: ["integer", "null"], minimum: 0 },
          publicationState,
          verificationState,
          evidenceIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          featured: { type: "boolean" },
          canonicalEntityId: { type: "string" },
          entityRole: {
            enum: [
              "primary",
              "recording",
              "mirror",
              "translation",
              "implementation",
              "component",
              "reference",
              "profile",
            ],
          },
          sourceRecord: { $ref: "#/$defs/sourceRecord" },
        },
      },
      entity: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "slug",
          "slugAliases",
          "kind",
          "title",
          "displayTitle",
          "shortTitle",
          "summary",
          "practice",
          "representativeDate",
          "year",
          "role",
          "organizationIds",
          "topics",
          "primaryItemId",
          "itemIds",
          "parentEntityIds",
          "countability",
          "sourceBasis",
          "childCounts",
          "publicationState",
          "verificationState",
        ],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          slugAliases: { type: "array", items: { type: "string" }, uniqueItems: true },
          kind: { enum: ["work", "occurrence", "artifact", "program"] },
          title: { type: "string" },
          displayTitle: { type: "string" },
          shortTitle: { type: "string" },
          summary: { type: "string" },
          practice: { enum: ["teach", "build", "convene"] },
          representativeDate: contentDate,
          year: { type: ["integer", "null"] },
          role: { type: "string" },
          organizationIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          topics: { type: "array", items: { type: "string" }, uniqueItems: true },
          primaryItemId: { type: ["string", "null"] },
          itemIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          parentEntityIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          countability: { enum: ["unique_work", "representation", "context"] },
          sourceBasis: {
            enum: ["footprint", "supplemental", "mixed", "synthetic"],
          },
          childCounts: {
            type: "object",
            additionalProperties: false,
            required: ["items", "occurrences", "artifacts"],
            properties: {
              items: { type: "integer", minimum: 0 },
              occurrences: { type: "integer", minimum: 0 },
              artifacts: { type: "integer", minimum: 0 },
            },
          },
          publicationState,
          verificationState,
        },
      },
      workGroup: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "slug",
          "slugAliases",
          "title",
          "shortTitle",
          "summary",
          "roleSummary",
          "bucket",
          "featuredOrder",
          "primaryEntityId",
          "memberEntityIds",
          "programEntityIds",
          "contextEntityIds",
          "itemIds",
          "period",
          "yearStart",
          "yearEnd",
          "organizationIds",
          "topics",
          "formats",
          "publicationState",
          "verificationState",
        ],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          slugAliases: { type: "array", items: { type: "string" }, uniqueItems: true },
          title: { type: "string" },
          shortTitle: { type: "string" },
          summary: { type: "string" },
          roleSummary: { type: "string" },
          bucket: {
            enum: [
              "products-open-source",
              "courses-learning",
              "writing-research",
              "talks-programs",
            ],
          },
          featuredOrder: { type: ["integer", "null"], minimum: 1 },
          primaryEntityId: { type: "string" },
          memberEntityIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          programEntityIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          contextEntityIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          itemIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          period: contentDate,
          yearStart: { type: ["integer", "null"] },
          yearEnd: { type: ["integer", "null"] },
          organizationIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          topics: { type: "array", items: { type: "string" }, uniqueItems: true },
          formats: {
            type: "array",
            items: {
              enum: [
                "event",
                "article",
                "course",
                "recording",
                "technical_report",
                "external_reference",
                "producer_credit",
                "translation",
                "mirror",
                "profile",
                "open_source_repo",
                "open_source_pr",
              ],
            },
            uniqueItems: true,
          },
          publicationState,
          verificationState,
        },
      },
      groupingLedgerEntry: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "workGroupId",
          "decision",
          "rule",
          "entityIds",
          "contextEntityIds",
          "itemIds",
          "rationale",
        ],
        properties: {
          id: { type: "string" },
          workGroupId: { type: ["string", "null"] },
          decision: {
            enum: [
              "same_story",
              "same_occurrence_representation",
              "program_sibling",
              "standalone",
              "reference_only",
            ],
          },
          rule: {
            enum: [
              "explicit_curation",
              "typed_relation",
              "deterministic_standalone",
              "context_classification",
            ],
          },
          entityIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          contextEntityIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          itemIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          rationale: { type: "string" },
        },
      },
      groupingLedger: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "repeatedTitleClusterCount",
          "repeatedUrlClusterCount",
          "entries",
        ],
        properties: {
          schemaVersion: { const: "1.0" },
          repeatedTitleClusterCount: { type: "integer", minimum: 0 },
          repeatedUrlClusterCount: { type: "integer", minimum: 0 },
          entries: {
            type: "array",
            items: { $ref: "#/$defs/groupingLedgerEntry" },
          },
        },
      },
      metricPeriod: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "asOf", "label"],
        properties: {
          start: { type: ["string", "null"] },
          end: { type: ["string", "null"] },
          asOf: { type: ["string", "null"] },
          label: { type: "string" },
        },
      },
      additionalContentDate: {
        type: "object",
        additionalProperties: false,
        required: ["label", "start", "end", "precision", "basis"],
        properties: {
          label: { type: "string" },
          start: { type: ["string", "null"] },
          end: { type: ["string", "null"] },
          precision: { enum: ["day", "month", "year", "unknown"] },
          basis: { enum: ["event_date", "publication_date", "upload_date", "unknown"] },
        },
      },
      metric: {
        type: "object",
        required: [
          "id",
          "subjectId",
          "category",
          "key",
          "label",
          "qualifier",
          "period",
          "sourceLabel",
          "scope",
          "attribution",
          "displaySurfaces",
          "publicationState",
          "verificationState",
        ],
        properties: {
          id: { type: "string" },
          subjectId: { type: "string" },
          category: { type: "string" },
          key: { type: "string" },
          label: { type: "string" },
          qualifier: { type: ["string", "null"] },
          period: { $ref: "#/$defs/metricPeriod" },
          sourceLabel: { type: "string" },
          scope: {
            enum: ["item", "work", "occurrence", "program", "collection", "portfolio"],
          },
          attribution: { enum: ["direct", "associated", "contextual"] },
          displaySurfaces: {
            type: "array",
            items: { enum: ["item_detail", "collection", "homepage", "sources"] },
            uniqueItems: true,
          },
          publicationState,
          verificationState,
          value: { type: ["number", "string", "boolean"] },
          unit: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          sourceRecord: { $ref: "#/$defs/sourceRecord" },
          displayValue: { type: "string" },
          publicEvidenceIds: { type: "array", items: { type: "string" } },
        },
        oneOf: [
          {
            required: ["value", "unit", "evidenceIds", "sourceRecord"],
            not: { anyOf: [{ required: ["displayValue"] }, { required: ["publicEvidenceIds"] }] },
          },
          {
            required: ["displayValue", "publicEvidenceIds"],
            not: {
              anyOf: [
                { required: ["value"] },
                { required: ["unit"] },
                { required: ["evidenceIds"] },
                { required: ["sourceRecord"] },
              ],
            },
          },
        ],
        additionalProperties: false,
      },
      metricPresentationGroup: {
        type: "object",
        additionalProperties: false,
        required: ["id", "theme", "title", "order", "leadMetricId", "metricIds"],
        properties: {
          id: { type: "string" },
          theme: { enum: ["learning", "product", "programs", "archive"] },
          title: { type: "string" },
          order: { type: "integer", minimum: 1 },
          leadMetricId: { type: "string" },
          metricIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
      },
      evidence: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "kind",
          "access",
          "capturedAt",
          "verificationState",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          kind: {
            enum: [
              "web_page",
              "video",
              "repository",
              "profile",
              "methodology",
              "internal_record",
            ],
          },
          access: { enum: ["public_web", "company_internal", "owner_private"] },
          url: { type: "string", pattern: "^(?:https?://|file://|/)" },
          publisher: { type: "string" },
          capturedAt: { type: "string" },
          verificationState,
        },
      },
      relation: {
        type: "object",
        additionalProperties: false,
        required: ["id", "fromId", "toId", "predicate", "confidence", "rationale"],
        properties: {
          id: { type: "string" },
          fromId: { type: "string" },
          toId: { type: "string" },
          predicate: {
            enum: [
              "recording_of",
              "mirror_of",
              "translation_of",
              "derivative_of",
              "part_of",
              "implements",
              "references",
            ],
          },
          confidence: { enum: ["high", "medium"] },
          rationale: { type: "string" },
        },
      },
      collection: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "itemIds", "metricIds"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          itemIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          metricIds: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
      },
      narrative: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "body", "placement", "publicationState"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          placement: { enum: ["home", "work", "play", "about", "sources", "owner_archive"] },
          publicationState,
          sourceSnapshotId: { type: "string" },
        },
      },
      sourceSnapshot: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "capturedAt",
          "rowCount",
          "sectionCount",
          "access",
        ],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          capturedAt: { type: "string" },
          rowCount: { type: ["integer", "null"] },
          sectionCount: { type: ["integer", "null"] },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          access: { enum: ["public_web", "company_internal", "owner_private"] },
          sourceFile: { type: "string" },
        },
      },
    },
  };
}

function assertUniqueIds(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`Duplicate ${label} ID: ${value.id}`);
    seen.add(value.id);
  }
}

function assertBundleIntegrity(bundle, { publicOnly = false } = {}) {
  const expectedSummary = {
    footprintRows: EXPECTED_FOOTPRINT_ROWS,
    impactRows: EXPECTED_IMPACT_ROWS,
    supplementalArtifacts: bundle.items.filter((item) => item.id.startsWith("item:md-")).length,
    publicItems: bundle.items.length,
    approvedMetricCount: 13,
    footprintBackedUniqueWorks: bundle.entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        (entity.sourceBasis === "footprint" || entity.sourceBasis === "mixed"),
    ).length,
    supplementalUniqueWorks: bundle.entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        entity.sourceBasis === "supplemental",
    ).length,
  };
  for (const [field, expected] of Object.entries(expectedSummary)) {
    if (bundle.sourceSummary[field] !== expected) {
      throw new Error(
        `Source summary ${field} mismatch: expected ${expected}, found ${bundle.sourceSummary[field]}`,
      );
    }
  }

  for (const [label, values] of Object.entries({
    item: bundle.items,
    entity: bundle.entities,
    workGroup: bundle.workGroups,
    metric: bundle.metrics,
    metricGroup: bundle.metricGroups,
    groupingLedgerEntry: bundle.groupingLedger?.entries || [],
    evidence: bundle.evidence,
    relation: bundle.relations,
    collection: bundle.collections,
    narrative: bundle.narratives,
    snapshot: bundle.sourceSnapshots,
    organization: bundle.organizations,
  })) {
    assertUniqueIds(values, label);
  }

  const itemIds = new Set(bundle.items.map((item) => item.id));
  const entityIds = new Set(bundle.entities.map((entity) => entity.id));
  const metricIds = new Set(bundle.metrics.map((metric) => metric.id));
  const workGroupIds = new Set(bundle.workGroups.map((group) => group.id));
  const evidenceIds = new Set(bundle.evidence.map((evidence) => evidence.id));
  const organizationIds = new Set(bundle.organizations.map((organization) => organization.id));
  const collectionIds = new Set(bundle.collections.map((collection) => collection.id));
  const subjects = new Set([
    ...itemIds,
    ...entityIds,
    ...workGroupIds,
    ...collectionIds,
    bundle.profile.id,
    ...organizationIds,
  ]);

  for (const item of bundle.items) {
    if (!entityIds.has(item.canonicalEntityId)) {
      throw new Error(`Item ${item.id} has missing canonical entity ${item.canonicalEntityId}`);
    }
    for (const organizationId of item.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`Item ${item.id} has missing organization ${organizationId}`);
      }
    }
    for (const evidenceId of item.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Item ${item.id} has missing evidence ${evidenceId}`);
      }
    }
  }
  for (const entity of bundle.entities) {
    if (entity.primaryItemId && !itemIds.has(entity.primaryItemId)) {
      throw new Error(`Entity ${entity.id} has missing primary item ${entity.primaryItemId}`);
    }
    for (const itemId of entity.itemIds) {
      if (!itemIds.has(itemId)) throw new Error(`Entity ${entity.id} has missing item ${itemId}`);
    }
    for (const parentEntityId of entity.parentEntityIds) {
      if (!entityIds.has(parentEntityId)) {
        throw new Error(`Entity ${entity.id} has missing parent ${parentEntityId}`);
      }
    }
    for (const organizationId of entity.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`Entity ${entity.id} has missing organization ${organizationId}`);
      }
    }
  }
  const eligibleEntityIds = new Set(
    bundle.entities
      .filter(
        (entity) =>
          entity.publicationState === "public" &&
          entity.countability === "unique_work",
      )
      .map((entity) => entity.id),
  );
  const eligibleMembership = countBy(
    bundle.workGroups.flatMap((group) =>
      group.memberEntityIds.filter((entityId) => eligibleEntityIds.has(entityId)),
    ),
    (entityId) => entityId,
  );
  for (const entityId of eligibleEntityIds) {
    if (eligibleMembership.get(entityId) !== 1) {
      throw new Error(`Eligible entity ${entityId} is not assigned to one WorkGroup`);
    }
  }
  for (const group of bundle.workGroups) {
    if (!group.memberEntityIds.includes(group.primaryEntityId)) {
      throw new Error(`WorkGroup ${group.id} lacks its primary entity`);
    }
    for (const entityId of [
      ...group.memberEntityIds,
      ...group.programEntityIds,
      ...group.contextEntityIds,
    ]) {
      if (!entityIds.has(entityId)) {
        throw new Error(`WorkGroup ${group.id} has missing entity ${entityId}`);
      }
    }
    if (
      group.programEntityIds.some(
        (entityId) =>
          bundle.entities.find((entity) => entity.id === entityId)?.kind !== "program",
      )
    ) {
      throw new Error(`WorkGroup ${group.id} has a non-program program parent`);
    }
    for (const itemId of group.itemIds) {
      if (!itemIds.has(itemId)) {
        throw new Error(`WorkGroup ${group.id} has missing item ${itemId}`);
      }
    }
    for (const organizationId of group.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`WorkGroup ${group.id} has missing organization`);
      }
    }
    if (
      group.yearStart !== null &&
      group.yearEnd !== null &&
      group.yearStart > group.yearEnd
    ) {
      throw new Error(`WorkGroup ${group.id} has an inverted period`);
    }
  }
  for (const metric of bundle.metrics) {
    if (!subjects.has(metric.subjectId)) {
      throw new Error(`Metric ${metric.id} has missing subject ${metric.subjectId}`);
    }
    const ids = "publicEvidenceIds" in metric ? metric.publicEvidenceIds : metric.evidenceIds;
    for (const evidenceId of ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Metric ${metric.id} has missing evidence ${evidenceId}`);
      }
    }
  }
  for (const relation of bundle.relations) {
    if (!itemIds.has(relation.fromId) || !itemIds.has(relation.toId)) {
      throw new Error(`Relation ${relation.id} has a missing item target`);
    }
  }
  for (const collection of bundle.collections) {
    for (const itemId of collection.itemIds) {
      if (!itemIds.has(itemId)) throw new Error(`Collection ${collection.id} missing item ${itemId}`);
    }
    for (const metricId of collection.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Collection ${collection.id} missing metric ${metricId}`);
      }
    }
  }
  for (const group of bundle.metricGroups) {
    if (!metricIds.has(group.leadMetricId)) {
      throw new Error(`Metric group ${group.id} has missing lead metric`);
    }
    for (const metricId of group.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Metric group ${group.id} has missing metric ${metricId}`);
      }
    }
  }
  for (const entry of bundle.groupingLedger?.entries || []) {
    if (entry.workGroupId && !workGroupIds.has(entry.workGroupId)) {
      throw new Error(`Grouping ledger ${entry.id} has missing WorkGroup`);
    }
    for (const entityId of [...entry.entityIds, ...entry.contextEntityIds]) {
      if (!entityIds.has(entityId)) {
        throw new Error(`Grouping ledger ${entry.id} has missing entity`);
      }
    }
    for (const itemId of entry.itemIds) {
      if (!itemIds.has(itemId)) {
        throw new Error(`Grouping ledger ${entry.id} has missing item`);
      }
    }
  }

  if (publicOnly) {
    if (bundle.items.some((item) => item.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public item");
    }
    if (bundle.entities.some((entity) => entity.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public entity");
    }
    if (bundle.workGroups.some((group) => group.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public WorkGroup");
    }
    if (bundle.metrics.some((metric) => metric.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public metric");
    }
    if (bundle.evidence.some((evidence) => evidence.access !== "public_web")) {
      throw new Error("Public bundle contains non-public evidence");
    }
    if (bundle.groupingLedger) {
      throw new Error("Public bundle contains owner-only grouping data");
    }
  }
}

function assertPublicSafety(publicBundle) {
  const combined = JSON.stringify(publicBundle).toLowerCase();
  for (const fragment of BLOCKED_PUBLIC_TEXT) {
    if (combined.includes(fragment)) throw new Error(`Public data contains blocked text: ${fragment}`);
  }

  for (const metric of publicBundle.metrics) {
    for (const forbidden of ["value", "unit", "evidenceIds", "sourceRecord"]) {
      if (Object.hasOwn(metric, forbidden)) {
        throw new Error(`Public metric ${metric.id} exposes forbidden field ${forbidden}`);
      }
    }
    if (typeof metric.displayValue !== "string" || !APPROVED_PUBLIC_DISPLAYS.has(metric.displayValue)) {
      throw new Error(`Public metric ${metric.id} lacks approved display copy`);
    }
    if (metric.key.includes("tool_calls") && metric.displayValue.includes("$")) {
      throw new Error(`Public tool-call metric ${metric.id} uses currency formatting`);
    }
  }

  if (Object.hasOwn(publicBundle, "groupingLedger")) {
    throw new Error("Public bundle exposes owner-only curation");
  }

  for (const snapshot of publicBundle.sourceSnapshots) {
    if (Object.hasOwn(snapshot, "sha256") || Object.hasOwn(snapshot, "sourceFile")) {
      throw new Error(`Public snapshot ${snapshot.id} exposes private provenance`);
    }
  }

  const checkUrl = (url, context) => {
    if (url.startsWith("/")) return;
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${context} uses an unsafe URL protocol`);
    }
    const normalized = url.toLowerCase();
    if (BLOCKED_PUBLIC_TEXT.some((fragment) => normalized.includes(fragment))) {
      throw new Error(`${context} uses a blocked URL`);
    }
  };

  for (const item of publicBundle.items) {
    for (const entry of item.urls) checkUrl(entry.url, `Item ${item.id}`);
  }
  for (const evidence of publicBundle.evidence) {
    if (evidence.url) checkUrl(evidence.url, `Evidence ${evidence.id}`);
  }
}

function buildQualityReport({
  contentVersion,
  footprintRows,
  impactRows,
  footprintSections,
  impactSections,
  ownerBundle,
  publicBundle,
}) {
  const footprintCategories = [...countBy(footprintRows, (row) => row.category).entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const confidenceCounts = [...countBy(footprintRows, (row) => row.confidence).entries()].sort(
    (left, right) => right[1] - left[1],
  );
  const relationCounts = [...countBy(ownerBundle.relations, (relation) => relation.predicate).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([predicate, count]) => `| ${predicate} | ${count} |`)
    .join("\n");
  const categoryRows = footprintCategories
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join("\n");
  const repeatedTitles = [...countBy(footprintRows, (row) => normalizedTitle(row.title)).values()].filter(
    (count) => count > 1,
  ).length;
  const urls = footprintRows.flatMap((row) => [row.primary_url, row.secondary_url].filter(Boolean));
  const repeatedUrls = [...countBy(urls, normalizeUrl).values()].filter((count) => count > 1).length;
  const durationSeconds = ownerBundle.items.reduce(
    (total, item) => total + (item.durationSeconds || 0),
    0,
  );
  const correctedUrls = ownerBundle.items
    .flatMap((item) => item.urls)
    .filter((entry) => entry.url === CORRECT_MLOPS_URL).length;
  const privateMetricKeys = [
    ...new Set(
      impactRows
        .filter(
          (row) =>
            ![
              "public_event_references",
              "unique_recordings",
              "articles",
              "reports",
              "producer_credits",
              "translations",
            ].includes(row.metric),
        )
        .map((row) => row.metric),
    ),
  ].sort();
  const publicClaimIds = publicBundle.metrics.map((metric) => `- \`${metric.id}\``).join("\n");
  const ownerExactMetricCount = ownerBundle.metrics.filter((metric) =>
    Object.hasOwn(metric, "sourceRecord"),
  ).length;
  const footprintItemCount = ownerBundle.items.filter(
    (item) => item.sourceRecord?.snapshotId === "snapshot:public-footprint-csv",
  ).length;
  const supplementalItemCount = ownerBundle.items.length - footprintItemCount;
  const entityCounts = [...countBy(ownerBundle.entities, (entity) => entity.kind).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const workGroupCounts = [
    ...countBy(publicBundle.workGroups, (group) => group.bucket).entries(),
  ]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([bucket, count]) => `${bucket} ${count}`)
    .join(", ");
  const groupingDecisionCounts = [
    ...countBy(
      ownerBundle.groupingLedger.entries,
      (entry) => entry.decision,
    ).entries(),
  ]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([decision, count]) => `${decision} ${count}`)
    .join(", ");

  return `# Canonical content migration quality report

Generated from four immutable source files plus reviewed canonical and presentation curation. Content version: \`${contentVersion}\`.

## Source accounting

| Source | Plan baseline | Current parsed | Accounted |
|---|---:|---:|---:|
| Public footprint CSV | ${EXPECTED_FOOTPRINT_ROWS} | ${footprintRows.length} | ${footprintItemCount} |
| Impact metrics CSV | ${PLAN_BASELINE_IMPACT_ROWS} | ${impactRows.length} | ${ownerExactMetricCount} |
| Public footprint Markdown | — | ${footprintSections.length} level-two sections | ${footprintSections.length} owner narrative blocks |
| Impact report Markdown | — | ${impactSections.length} level-two sections | ${impactSections.length} owner narrative blocks |

The impact CSV has **${impactRows.length - PLAN_BASELINE_IMPACT_ROWS} more rows** than the plan baseline. The importer keeps all current rows and treats the file as the authority.

The canonical bundle also contains **${supplementalItemCount} reviewed public artifacts** sourced from explicit links in the supplied Markdown, without changing or replacing any footprint observation.

## Footprint inventory

| Category | Rows |
|---|---:|
${categoryRows}

- Confidence distribution: ${confidenceCounts.map(([label, count]) => `${label} ${count}`).join(", ")}.
- Repeated normalized titles: ${repeatedTitles}; repeated canonical URLs: ${repeatedUrls}.
- Recording duration represented: ${durationSeconds} seconds (${Math.floor(durationSeconds / 3600)}h ${Math.floor(
    (durationSeconds % 3600) / 60,
  )}m ${durationSeconds % 60}s).
- Known MLOps Community URL corrections applied: ${correctedUrls}.

## Relations

| Predicate | Generated |
|---|---:|
${relationCounts || "| none | 0 |"}

Recording relations require a unique best typed match across URL role, date, exact title, and organization. Reviewed curation supplies explicit corrections and relationships; title-only ties never write a relation.

## Canonical entities

- Entity groups: ${ownerBundle.entities.length} (${entityCounts}).
- Source observations keep stable opaque IDs and retain their legacy IDs and route aliases.
- Work, occurrence, artifact, and program groupings preserve every source item; representations and context records remain inspectable without inflating unique-work views.

## Public WorkGroups

- Public WorkGroups: ${publicBundle.workGroups.length} (${workGroupCounts}).
- Every public \`unique_work\` entity belongs to exactly one WorkGroup, including the reviewed EvalForge supplemental work.
- Explicit curation groups related courses, workshop editions, regional broadcasts, repeated talk deliveries, pull-request families, and production credits without changing canonical entity IDs or legacy routes.
- Remaining eligible entities receive deterministic standalone groups; context entities never become standalone WorkGroups.
- Owner-only grouping ledger decisions: ${groupingDecisionCounts}.
- Duplicate titles and URLs alone never create a grouping; the ledger requires explicit curation, typed relations, or deterministic standalone classification.

## Publication projection

- Owner bundle: ${ownerBundle.items.length} items (${footprintItemCount} footprint observations + ${supplementalItemCount} reviewed Markdown artifacts), ${ownerExactMetricCount} exact metric observations plus ${publicBundle.metrics.length} reviewed public projections, ${ownerBundle.evidence.length} evidence records, and ${ownerBundle.narratives.length} source narrative blocks.
- Public bundle: ${publicBundle.items.length} public items, ${publicBundle.entities.length} canonical entities, ${publicBundle.workGroups.length} WorkGroups, ${publicBundle.metrics.length} rounded or derived public measures in ${publicBundle.metricGroups.length} presentation groups, ${publicBundle.evidence.length} public evidence records, and ${publicBundle.collections.length} collections.
- Exact metric observations remain only in the ignored owner bundle.
- The July MCP usage checkpoint and the cross-year tracked-program total replace their older public headline checkpoints; exact source values remain owner-only.
- Public metrics contain display strings and qualifiers, never raw numeric value fields.
- Internal evidence URLs, source excerpts, local paths, and source hashes are excluded from public output.

Public measure records:

${publicClaimIds}

## Private or excluded metric families

The following source metric families remain exact only in the owner bundle unless represented by a separately reviewed rounded public claim:

${privateMetricKeys.map((key) => `- \`${key}\``).join("\n")}

Completion floors, paid-organization associations, aggregate course-campaign leads, failure or support telemetry, private projects, customer names, team allocations, and warehouse-only attribution views are not copied into public data.

## Verification checks

- Stable opaque source-observation IDs are unique across all ${ownerBundle.items.length} items; legacy IDs and old route slugs remain aliases.
- Every organization, entity, evidence, relation, collection, and metric subject reference resolves.
- Every WorkGroup member, context entity, item, organization, and metric presentation reference resolves.
- All ${footprintRows.length} footprint rows and ${impactRows.length} impact rows retain source-row fingerprints in the owner bundle.
- Tool-call display values are validated against currency prefixes.
- Item-detail metrics require an explicit item or canonical-entity subject; collection metrics are never inherited implicitly.
- The public projection contains only \`public\` publication states and \`public_web\` evidence.
- Public URLs pass protocol and blocked-domain checks.
- Re-running the importer with unchanged inputs produces byte-identical generated outputs.
`;
}

async function writeAtomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

async function writeOrCheck(outputs, check) {
  for (const [file, content] of outputs) {
    if (check) {
      let current;
      try {
        current = await readFile(file, "utf8");
      } catch {
        throw new Error(`Generated output is missing: ${path.relative(PROJECT_ROOT, file)}`);
      }
      if (current !== content) {
        throw new Error(`Generated output is stale: ${path.relative(PROJECT_ROOT, file)}`);
      }
    } else {
      await writeAtomic(file, content);
    }
  }
}

export async function buildContent({ check = false } = {}) {
  const [
    footprintCsv,
    footprintMarkdown,
    impactCsv,
    impactMarkdown,
    curationSource,
    workGroupSource,
    metricGroupSource,
    claimUpgradeSource,
  ] = await Promise.all([
    readFile(SOURCE_FILES.footprintCsv, "utf8"),
    readFile(SOURCE_FILES.footprintMarkdown, "utf8"),
    readFile(SOURCE_FILES.impactCsv, "utf8"),
    readFile(SOURCE_FILES.impactMarkdown, "utf8"),
    readFile(SOURCE_FILES.curation, "utf8"),
    readFile(SOURCE_FILES.workGroups, "utf8"),
    readFile(SOURCE_FILES.metricGroups, "utf8"),
    readFile(SOURCE_FILES.claimUpgrades, "utf8"),
  ]);
  const curation = JSON.parse(curationSource);
  const workGroupCuration = JSON.parse(workGroupSource);
  const metricGroupPresentation = JSON.parse(metricGroupSource);
  const claimUpgrades = JSON.parse(claimUpgradeSource);
  if (curation.schemaVersion !== CURATION_SCHEMA_VERSION) {
    throw new Error(`Canonical curation schema must be ${CURATION_SCHEMA_VERSION}`);
  }
  const footprintRows = parseCsv(footprintCsv, path.basename(SOURCE_FILES.footprintCsv));
  const impactRows = parseCsv(impactCsv, path.basename(SOURCE_FILES.impactCsv));
  if (footprintRows.length !== EXPECTED_FOOTPRINT_ROWS) {
    throw new Error(
      `Footprint row count changed: expected ${EXPECTED_FOOTPRINT_ROWS}, found ${footprintRows.length}`,
    );
  }
  if (impactRows.length !== EXPECTED_IMPACT_ROWS) {
    throw new Error(
      `Impact row count changed: expected ${EXPECTED_IMPACT_ROWS}, found ${impactRows.length}`,
    );
  }

  const recordedDates = impactRows
    .map((row) => normalizeRecordedDate(row.date_recorded))
    .filter(Boolean)
    .sort();
  const asOf = recordedDates.at(-1);
  const generatedAt = `${asOf}T00:00:00.000Z`;
  const sourceContents = [
    footprintCsv,
    footprintMarkdown,
    impactCsv,
    impactMarkdown,
    curationSource,
    workGroupSource,
    metricGroupSource,
    claimUpgradeSource,
  ];
  const [pipelineSource, csvParserSource] = await Promise.all([
    readFile(fileURLToPath(import.meta.url), "utf8"),
    readFile(path.join(PROJECT_ROOT, "scripts/lib/csv.mjs"), "utf8"),
  ]);
  const contentVersion = shortHash(
    [...sourceContents, pipelineSource, csvParserSource]
      .map((content) => sha256(content))
      .join(":"),
  );

  const ownerItems = [
    ...makePortfolioItems(footprintRows, curation),
    ...makeSupplementalItems(curation),
  ];
  assertUniqueItemSlugs(ownerItems);
  const publicEvidence = buildPublicEvidence(ownerItems, asOf);
  const organizations = buildOrganizations(footprintRows, curation);
  const relations = buildRelations(ownerItems, curation);
  const entities = buildCanonicalEntities(ownerItems, relations, curation);
  const ownerEvidence = structuredClone(publicEvidence);
  const ownerMetrics = buildOwnerMetrics(
    impactRows,
    ownerItems,
    entities,
    curation,
    ownerEvidence,
    asOf,
  );
  const footprintSections = parseMarkdownSections(
    footprintMarkdown,
    "public-footprint",
    "review_required",
  );
  const impactSections = parseMarkdownSections(impactMarkdown, "impact-report", "private");
  const ownerNarratives = [...footprintSections, ...impactSections];
  const publicMetrics = buildPublicMetrics(
    impactRows,
    ownerItems,
    entities,
    claimUpgrades,
  );
  const collections = buildCollections(ownerItems, publicMetrics);
  const workGroups = buildWorkGroups(ownerItems, entities, workGroupCuration);
  const groupingLedger = buildGroupingLedger(
    ownerItems,
    entities,
    workGroups,
    workGroupCuration,
    footprintRows,
  );
  const metricGroups = buildMetricGroups(publicMetrics, metricGroupPresentation);
  const selected = collections.find((collection) => collection.id === "collection:selected-work");
  markFeatured(ownerItems, selected);

  const ownerSnapshots = [
    sourceSnapshot({
      id: "snapshot:public-footprint-csv",
      label: "Public footprint inventory",
      content: footprintCsv,
      capturedAt: asOf,
      rowCount: footprintRows.length,
      access: "public_web",
      sourceFile: path.basename(SOURCE_FILES.footprintCsv),
    }),
    sourceSnapshot({
      id: "snapshot:public-footprint-markdown",
      label: "Public footprint research report",
      content: footprintMarkdown,
      capturedAt: asOf,
      sectionCount: footprintSections.length,
      access: "public_web",
      sourceFile: path.basename(SOURCE_FILES.footprintMarkdown),
    }),
    sourceSnapshot({
      id: "snapshot:impact-csv",
      label: "Owner impact metric ledger",
      content: impactCsv,
      capturedAt: asOf,
      rowCount: impactRows.length,
      access: "owner_private",
      sourceFile: path.basename(SOURCE_FILES.impactCsv),
    }),
    sourceSnapshot({
      id: "snapshot:impact-report-markdown",
      label: "Owner impact research report",
      content: impactMarkdown,
      capturedAt: asOf,
      sectionCount: impactSections.length,
      access: "owner_private",
      sourceFile: path.basename(SOURCE_FILES.impactMarkdown),
    }),
    sourceSnapshot({
      id: "snapshot:curation-v1.1",
      label: "Reviewed canonical curation",
      content: curationSource,
      capturedAt: asOf,
      rowCount: null,
      sectionCount: null,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.curation),
    }),
    sourceSnapshot({
      id: "snapshot:work-groups-v1",
      label: "Reviewed WorkGroup curation",
      content: workGroupSource,
      capturedAt: asOf,
      rowCount: workGroupCuration.groups.length,
      sectionCount: workGroupCuration.contextDecisions.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.workGroups),
    }),
    sourceSnapshot({
      id: "snapshot:metric-groups-v1",
      label: "Public metric presentation groups",
      content: metricGroupSource,
      capturedAt: asOf,
      rowCount: metricGroupPresentation.groups.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.metricGroups),
    }),
    sourceSnapshot({
      id: "snapshot:public-claim-upgrades-v1",
      label: "Selected public measure revisions",
      content: claimUpgradeSource,
      capturedAt: asOf,
      rowCount: claimUpgrades.claims.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.claimUpgrades),
    }),
  ];

  const profile = buildProfile(ownerItems);
  const sourceSummary = {
    footprintRows: footprintRows.length,
    impactRows: impactRows.length,
    supplementalArtifacts: curation.supplementalItems.length,
    publicItems: ownerItems.length,
    approvedMetricCount: publicMetrics.length,
    footprintBackedUniqueWorks: entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        (entity.sourceBasis === "footprint" || entity.sourceBasis === "mixed"),
    ).length,
    supplementalUniqueWorks: entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        entity.sourceBasis === "supplemental",
    ).length,
  };
  const ownerBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    sourceSummary,
    profile,
    organizations,
    items: ownerItems,
    entities,
    workGroups,
    metrics: [...ownerMetrics, ...publicMetrics],
    metricGroups,
    evidence: ownerEvidence,
    relations,
    collections,
    narratives: ownerNarratives,
    sourceSnapshots: ownerSnapshots,
    groupingLedger,
  };

  const publicBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    sourceSummary,
    profile,
    organizations,
    items: ownerItems.map(stripPrivateItemFields),
    entities,
    workGroups,
    metrics: publicMetrics,
    metricGroups,
    evidence: publicEvidence,
    relations,
    collections,
    narratives: buildPublicNarratives(),
    sourceSnapshots: [
      {
        id: "snapshot:public-footprint-inventory",
        label: "Public footprint inventory",
        capturedAt: asOf,
        rowCount: footprintRows.length,
        sectionCount: footprintSections.length,
        access: "public_web",
      },
      {
        id: "snapshot:public-claims-review",
        label: "Rounded impact claim review",
        capturedAt: asOf,
        rowCount: publicMetrics.length,
        sectionCount: null,
        access: "public_web",
      },
    ],
  };
  const schema = buildJsonSchema();

  assertBundleIntegrity(ownerBundle);
  assertBundleIntegrity(publicBundle, { publicOnly: true });
  assertPublicSafety(publicBundle);

  const report = buildQualityReport({
    contentVersion,
    footprintRows,
    impactRows,
    footprintSections,
    impactSections,
    ownerBundle,
    publicBundle,
  });
  const outputs = new Map([
    [OUTPUT_FILES.owner, `${JSON.stringify(ownerBundle, null, 2)}\n`],
    [OUTPUT_FILES.public, `${JSON.stringify(publicBundle, null, 2)}\n`],
    [OUTPUT_FILES.schema, `${JSON.stringify(schema, null, 2)}\n`],
    [OUTPUT_FILES.report, report],
  ]);
  await writeOrCheck(outputs, check);

  return {
    contentVersion,
    footprintRows: footprintRows.length,
    impactRows: impactRows.length,
    publicItems: publicBundle.items.length,
    publicMetrics: publicBundle.metrics.length,
    relations: publicBundle.relations.length,
    checked: check,
  };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const summary = await buildContent({ check: process.argv.includes("--check") });
    process.stdout.write(
      `${summary.checked ? "Checked" : "Generated"} content ${summary.contentVersion}: ` +
        `${summary.footprintRows} footprint rows, ${summary.impactRows} impact rows, ` +
        `${summary.publicItems} public items, ${summary.publicMetrics} public metrics, ` +
        `${summary.relations} relations.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
