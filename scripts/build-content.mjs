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
};

const OUTPUT_FILES = {
  owner: path.join(PROJECT_ROOT, "content/private/anish-content.v1.json"),
  public: path.join(PROJECT_ROOT, "content/public/anish-content.public.v1.json"),
  schema: path.join(PROJECT_ROOT, "content/schema/anish-content.schema.json"),
  report: path.join(PROJECT_ROOT, "content/reports/migration-quality.md"),
};

const EXPECTED_FOOTPRINT_ROWS = 184;
const PLAN_BASELINE_IMPACT_ROWS = 61;
const SCHEMA_VERSION = "1.0";

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
  "Nearly 100K",
  "More than two-thirds",
  "Hundreds",
  "$2M+",
  "$300K+",
  "500+",
  "1K+ / 500+",
  "49",
  "19+",
]);

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

function normalizedTitle(value) {
  return slugify(value)
    .replace(/-(apple-podcasts|spotify|amazon-music|transcript-video-page|forem)$/, "")
    .replace(/-part-[0-9]+$/, "");
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

function makePortfolioItems(rows) {
  const candidates = rows.map((row, index) => {
    const start = row.date_start || row.year || null;
    const fingerprint = sha256(
      [row.category, row.title, row.date_start, row.primary_url, row.secondary_url, row.organization].join(
        "\u001f",
      ),
    );
    const baseId = `${row.category}:${start || "undated"}:${slugify(row.title)}`;
    return { row, index, start, fingerprint, baseId };
  });

  const idCounts = countBy(candidates, (candidate) => candidate.baseId);
  const slugCounts = countBy(candidates, (candidate) => slugify(candidate.row.title));

  return candidates.map(({ row, index, start, fingerprint, baseId }) => {
    const id =
      idCounts.get(baseId) === 1
        ? baseId
        : `${baseId}:${shortHash(
            [row.primary_url, row.secondary_url, row.organization, row.role].join("\u001f"),
            8,
          )}`;
    const baseSlug = slugify(row.title);
    const slug =
      slugCounts.get(baseSlug) === 1
        ? baseSlug
        : `${baseSlug}-${row.category}-${start || "undated"}-${shortHash(id, 6)}`;
    const urls = [
      row.primary_url && { kind: "primary", url: canonicalPublicUrl(row.primary_url) },
      row.secondary_url && { kind: "secondary", url: canonicalPublicUrl(row.secondary_url) },
    ].filter(Boolean);
    const organizationIds = row.organization ? [makeOrganizationId(row.organization)] : [];

    return {
      id,
      slug,
      type: row.category,
      title: row.title,
      date: {
        start,
        end: row.date_end || null,
        precision: start ? datePrecision(start) : "unknown",
        basis: dateBasis(row),
      },
      additionalDates: parseAdditionalDates(row),
      year: row.year ? Number(row.year) : null,
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
      sourceRecord: {
        snapshotId: "snapshot:public-footprint-csv",
        row: index + 2,
        fingerprint,
      },
    };
  });
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

function buildOrganizations(rows) {
  const names = [...new Set(rows.map((row) => row.organization).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  return names.map((name) => ({ id: makeOrganizationId(name), name }));
}

function sameTitle(left, right) {
  return normalizedTitle(left.title) === normalizedTitle(right.title);
}

function typePriority(item) {
  const index = TYPE_ORDER.indexOf(item.type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function buildRelations(items) {
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

  for (const item of items) {
    const secondary = item.urls.find((entry) => entry.kind === "secondary")?.url;

    if (item.type === "recording") {
      const events = items
        .filter(
          (candidate) =>
            candidate.type === "event" &&
            (sameTitle(item, candidate) ||
              candidate.urls.some((entry) =>
                item.urls.some((itemUrl) => normalizeUrl(itemUrl.url) === normalizeUrl(entry.url)),
              )),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      if (events[0]) {
        add(item.id, events[0].id, "recording_of", "high", "Shared title or canonical event URL.");
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
    [
      "You Need Evals — a Primer and New Techniques",
      "open_source_repo",
      "fugue",
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

  return [...relations.values()].sort((left, right) => left.id.localeCompare(right.id));
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

function resolveMetricSubject(row, items) {
  const exact = itemByTitle(items, row.item);
  if (exact) return exact.id;
  if (row.item === "W&B MCP Server") {
    return itemByTitle(items, "wandb-mcp-server", "open_source_repo")?.id || "collection:product";
  }
  if (row.item === "W&B MCP Server GA launch") {
    return (
      itemByTitle(
        items,
        "Introducing the W&B MCP Server: An Agent-Native Interface for Your Experiments and Traces",
        "article",
      )?.id || "collection:product"
    );
  }
  if (/all 3 anish courses/i.test(row.item)) return "collection:courses";
  if (/public recordings/i.test(row.item)) return "collection:recordings";
  if (/public event|all .*events|events count/i.test(row.item)) return "collection:events";
  return `collection:${row.category}`;
}

function titleFromMetricKey(key) {
  return key
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function buildOwnerMetrics(rows, items, ownerEvidence, capturedAt) {
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
    metrics.push({
      id: `metric:source:${slugify(row.category)}:${slugify(row.item)}:${slugify(
        row.metric,
      )}:${slugify(row.date_recorded)}:${shortHash(row.period, 8)}`,
      subjectId: resolveMetricSubject(row, items),
      category: row.category,
      key: row.metric,
      label: `${row.item} — ${titleFromMetricKey(row.metric)}`,
      qualifier: row.notes || null,
      period: metricPeriod(row.period, row.date_recorded),
      sourceLabel: row.source_name || titleFromMetricKey(row.source_system),
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

function buildPublicMetrics(impactRows, items) {
  const internalEvidence = ["evidence:methodology:internal-analytics"];
  const publicEvidence = ["evidence:methodology:public-footprint"];
  const courseCollection = "collection:courses";
  const eventCollection = "collection:events";
  const mcpId =
    itemByTitle(items, "wandb-mcp-server", "open_source_repo")?.id || "collection:product";

  const definitions = [
    {
      id: "metric:courses:enrollments:2026-07-30",
      subjectId: courseCollection,
      category: "courses",
      key: "course_enrollments",
      displayValue: "7K+",
      label: "course enrollments across three AI courses",
      qualifier: "Enrollments, not unique learners.",
      period: { start: "2024-06", end: "2026-07", asOf: "2026-07-30", label: "2024–2026" },
      selectors: [{ item: "All 3 Anish courses", metric: "enrollments_total" }],
    },
    {
      id: "metric:courses:same-day-account-share:2026-07-30",
      subjectId: courseCollection,
      category: "courses",
      key: "same_day_account_creation_share",
      displayValue: "About half",
      label: "of course enrollments accompanied a W&B account created the same day",
      qualifier: "An observed same-day association, not a causal conversion claim.",
      period: { start: "2024-06", end: "2026-07", asOf: "2026-07-30", label: "2024–2026" },
      selectors: [
        { item: "All 3 Anish courses", metric: "enrollments_total" },
        { item: "All 3 Anish courses", metric: "course_sourced_wandb_signups" },
      ],
    },
    {
      id: "metric:course:llm-apps-evaluation:launch-signups:2025-01-10",
      subjectId: itemByTitle(items, "LLM Apps: Evaluation", "course")?.id || courseCollection,
      category: "courses",
      key: "launch_signups",
      displayValue: "1K+",
      label: "Evals-course signups in roughly 36 hours",
      qualifier: "Rounded down from the internal launch checkpoint.",
      period: { start: "2025-01-08", end: "2025-01-10", asOf: "2025-01-10", label: "~36 hours" },
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
      selectors: [
        { item: "W&B MCP Server", metric: "weekly_reengaged_users", date: "2026-07-28" },
      ],
    },
    {
      id: "metric:events:pipeline-supported:2025",
      subjectId: eventCollection,
      category: "events",
      key: "pipeline_supported",
      displayValue: "$2M+",
      label: "in pipeline supported by 2025 event programs",
      qualifier: "Program-supported pipeline, not generated revenue or individual ARR attribution.",
      period: { start: "2025", end: "2025", asOf: "2025-10-01", label: "2025" },
      selectors: [
        {
          item: "All 2025 events (Anish core IC/organizer)",
          metric: "pipeline_supported_usd",
        },
      ],
    },
    {
      id: "metric:events:ic-associated-pipeline:2024",
      subjectId: eventCollection,
      category: "events",
      key: "ic_associated_pipeline",
      displayValue: "$300K+",
      label: "in 2024 event pipeline associated with work where Anish was the IC",
      qualifier: "Association from an internal tracking split; warehouse data has no person-level mapping.",
      period: { start: "2024", end: "2024", asOf: "2025-01-01", label: "2024" },
      verificationState: "tentative",
      selectors: [
        { item: "2024 events where Anish was IC", metric: "pipeline_supported_usd" },
      ],
    },
    {
      id: "metric:event:nvidia-gtc:leads:2024",
      subjectId: eventCollection,
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
      selectors: [{ item: "NVIDIA GTC 2024", metric: "leads" }],
    },
    {
      id: "metric:event:fully-connected-sf:reach:2024",
      subjectId: eventCollection,
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
      sourceLabel: "Public footprint inventory",
      publicEvidenceIds: publicEvidence,
      verificationState: "derived",
      selectors: [{ item: "Public recordings 2021-2026", metric: "unique_recordings" }],
    },
  ];

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
      body: "A consent-aware view of what Anish watches, reads, and moves through: owner-authorized MyAnimeList and Hardcover syncs, with Strava loaded only through official public embeds after visitor intent.",
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
    $id: "https://anishshah.dev/schema/anish-content.v1.json",
    title: "Anish Shah Content Bundle",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "contentVersion",
      "generatedAt",
      "profile",
      "organizations",
      "items",
      "metrics",
      "evidence",
      "relations",
      "collections",
      "narratives",
      "sourceSnapshots",
    ],
    properties: {
      schemaVersion: { const: "1.0" },
      contentVersion: { type: "string", pattern: "^[a-f0-9]{16}$" },
      generatedAt: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$",
      },
      profile: { $ref: "#/$defs/profile" },
      organizations: { type: "array", items: { $ref: "#/$defs/organization" } },
      items: { type: "array", items: { $ref: "#/$defs/item" } },
      metrics: { type: "array", items: { $ref: "#/$defs/metric" } },
      evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
      relations: { type: "array", items: { $ref: "#/$defs/relation" } },
      collections: { type: "array", items: { $ref: "#/$defs/collection" } },
      narratives: { type: "array", items: { $ref: "#/$defs/narrative" } },
      sourceSnapshots: { type: "array", items: { $ref: "#/$defs/sourceSnapshot" } },
    },
    $defs: {
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
          "slug",
          "type",
          "title",
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
        ],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
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
          sourceRecord: { $ref: "#/$defs/sourceRecord" },
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
  for (const [label, values] of Object.entries({
    item: bundle.items,
    metric: bundle.metrics,
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
  const metricIds = new Set(bundle.metrics.map((metric) => metric.id));
  const evidenceIds = new Set(bundle.evidence.map((evidence) => evidence.id));
  const organizationIds = new Set(bundle.organizations.map((organization) => organization.id));
  const collectionIds = new Set(bundle.collections.map((collection) => collection.id));
  const subjects = new Set([...itemIds, ...collectionIds, bundle.profile.id, ...organizationIds]);

  for (const item of bundle.items) {
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

  if (publicOnly) {
    if (bundle.items.some((item) => item.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public item");
    }
    if (bundle.metrics.some((metric) => metric.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public metric");
    }
    if (bundle.evidence.some((evidence) => evidence.access !== "public_web")) {
      throw new Error("Public bundle contains non-public evidence");
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

  return `# Canonical content migration quality report

Generated from four immutable source files. Content version: \`${contentVersion}\`.

## Source accounting

| Source | Plan baseline | Current parsed | Accounted |
|---|---:|---:|---:|
| Public footprint CSV | ${EXPECTED_FOOTPRINT_ROWS} | ${footprintRows.length} | ${ownerBundle.items.length} |
| Impact metrics CSV | ${PLAN_BASELINE_IMPACT_ROWS} | ${impactRows.length} | ${ownerExactMetricCount} |
| Public footprint Markdown | — | ${footprintSections.length} level-two sections | ${footprintSections.length} owner narrative blocks |
| Impact report Markdown | — | ${impactSections.length} level-two sections | ${impactSections.length} owner narrative blocks |

The impact CSV has **${impactRows.length - PLAN_BASELINE_IMPACT_ROWS} more rows** than the plan baseline. The importer keeps all current rows and treats the file as the authority.

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

Relations are generated only from exact shared titles, canonical URLs, source links, or GitHub repository ownership. Fuzzy matching never writes a relation.

## Publication projection

- Owner bundle: ${ownerBundle.items.length} items, ${ownerExactMetricCount} exact metric observations plus ${publicBundle.metrics.length} reviewed public projections, ${ownerBundle.evidence.length} evidence records, and ${ownerBundle.narratives.length} source narrative blocks.
- Public bundle: ${publicBundle.items.length} public inventory items, ${publicBundle.metrics.length} approved rounded/derived claims, ${publicBundle.evidence.length} public evidence records, and ${publicBundle.collections.length} collections.
- Exact metric observations remain only in the ignored owner bundle.
- Public metrics contain display strings and qualifiers, never raw numeric value fields.
- Internal evidence URLs, source excerpts, local paths, and source hashes are excluded from public output.

Approved public claim records:

${publicClaimIds}

## Private or excluded metric families

The following source metric families remain exact only in the owner bundle unless represented by a separately reviewed rounded public claim:

${privateMetricKeys.map((key) => `- \`${key}\``).join("\n")}

Completion floors, paid-organization associations, aggregate course-campaign leads, failure or support telemetry, private projects, customer names, team allocations, and warehouse-only attribution views are not copied into public data.

## Verification checks

- Stable IDs and route slugs are content-derived and unique across all ${ownerBundle.items.length} items.
- Every organization, evidence, relation, collection, and metric subject reference resolves.
- All ${footprintRows.length} footprint rows and ${impactRows.length} impact rows retain source-row fingerprints in the owner bundle.
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
  const [footprintCsv, footprintMarkdown, impactCsv, impactMarkdown] = await Promise.all([
    readFile(SOURCE_FILES.footprintCsv, "utf8"),
    readFile(SOURCE_FILES.footprintMarkdown, "utf8"),
    readFile(SOURCE_FILES.impactCsv, "utf8"),
    readFile(SOURCE_FILES.impactMarkdown, "utf8"),
  ]);
  const footprintRows = parseCsv(footprintCsv, path.basename(SOURCE_FILES.footprintCsv));
  const impactRows = parseCsv(impactCsv, path.basename(SOURCE_FILES.impactCsv));
  if (footprintRows.length !== EXPECTED_FOOTPRINT_ROWS) {
    throw new Error(
      `Footprint row count changed: expected ${EXPECTED_FOOTPRINT_ROWS}, found ${footprintRows.length}`,
    );
  }
  if (impactRows.length < PLAN_BASELINE_IMPACT_ROWS) {
    throw new Error(
      `Impact row count regressed below the plan baseline: ${impactRows.length} < ${PLAN_BASELINE_IMPACT_ROWS}`,
    );
  }

  const recordedDates = impactRows
    .map((row) => normalizeRecordedDate(row.date_recorded))
    .filter(Boolean)
    .sort();
  const asOf = recordedDates.at(-1);
  const generatedAt = `${asOf}T00:00:00.000Z`;
  const sourceContents = [footprintCsv, footprintMarkdown, impactCsv, impactMarkdown];
  const [pipelineSource, csvParserSource] = await Promise.all([
    readFile(fileURLToPath(import.meta.url), "utf8"),
    readFile(path.join(PROJECT_ROOT, "scripts/lib/csv.mjs"), "utf8"),
  ]);
  const contentVersion = shortHash(
    [...sourceContents, pipelineSource, csvParserSource]
      .map((content) => sha256(content))
      .join(":"),
  );

  const ownerItems = makePortfolioItems(footprintRows);
  const publicEvidence = buildPublicEvidence(ownerItems, asOf);
  const organizations = buildOrganizations(footprintRows);
  const relations = buildRelations(ownerItems);
  const ownerEvidence = structuredClone(publicEvidence);
  const ownerMetrics = buildOwnerMetrics(impactRows, ownerItems, ownerEvidence, asOf);
  const footprintSections = parseMarkdownSections(
    footprintMarkdown,
    "public-footprint",
    "review_required",
  );
  const impactSections = parseMarkdownSections(impactMarkdown, "impact-report", "private");
  const ownerNarratives = [...footprintSections, ...impactSections];
  const publicMetrics = buildPublicMetrics(impactRows, ownerItems);
  const collections = buildCollections(ownerItems, publicMetrics);
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
  ];

  const profile = buildProfile(ownerItems);
  const ownerBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    profile,
    organizations,
    items: ownerItems,
    metrics: [...ownerMetrics, ...publicMetrics],
    evidence: ownerEvidence,
    relations,
    collections,
    narratives: ownerNarratives,
    sourceSnapshots: ownerSnapshots,
  };

  const publicBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    profile,
    organizations,
    items: ownerItems.map(stripPrivateItemFields),
    metrics: publicMetrics,
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
