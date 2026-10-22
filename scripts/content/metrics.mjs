/** Owner metric ingestion and explicitly reviewed public metric projection. */
import { PRESENTATION_SCHEMA_VERSION, itemByLegacyId } from "./grouping.mjs";
import { sha256, shortHash, slugify } from "./primitives.mjs";

export const APPROVED_PUBLIC_DISPLAYS = new Set([
  "7K+",
  "About half",
  "1K+",
  "200K+",
  "745K+",
  "76%",
  "70%",
  "≈4,800",
  "30",
  "More than two-thirds",
  "Hundreds",
  "$4M+",
  "$300K+",
  "500+",
  "1K+ / 500+",
  "49",
  "19+",
]);


export function parseMarkdownSections(markdown, sourceKey, publicationState) {
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

export function normalizeRecordedDate(value) {
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

export function buildOwnerMetrics(rows, items, entities, curation, ownerEvidence, capturedAt) {
  const metrics = [];
  let reviewedRow = 1;
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
        snapshotId: row.source_system === "owner_review" ? "snapshot:portfolio-updates-v1" : "snapshot:impact-csv",
        // Rows in the reviewed metric list are independent of the legacy CSV.
        row: row.source_system === "owner_review" ? ++reviewedRow : index + 2,
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

export function buildPublicMetrics(impactRows, items, entities, claimUpgrades) {
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
      label: "MCP users across 1K+ W&B organizations",
      qualifier: "Rounded cumulative users and W&B organizations through June 11, 2026. Organizations are not distinct companies or currently active accounts.",
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

  for (const addition of claimUpgrades.additions || []) {
    if (addition.publicationState !== "public" || definitions.some((entry) => entry.id === addition.id) ||
        !addition.period?.asOf || !addition.qualifier || !addition.sourceLabel ||
        !addition.selectors?.length) {
      throw new Error("A new public metric requires a unique dated, qualified, source-backed claim");
    }
    definitions.push(addition);
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
