/** Source-observation normalization, public evidence, organizations, and relations. */
import { TYPE_ORDER } from "./grouping.mjs";
import {
  canonicalPublicUrl,
  countBy,
  dateBasis,
  datePrecision,
  exactNormalizedTitle,
  inferTopics,
  locationKind,
  makeOrganizationId,
  normalizeUrl,
  parseAdditionalDates,
  parseDurationSeconds,
  sha256,
  shortHash,
  slugify,
  stableRouteSlug,
  unboundedSlug,
  verificationFromConfidence,
} from "./primitives.mjs";

export function makePortfolioItems(rows, curation) {
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

export function makeSupplementalItems(curation) {
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

export function assertUniqueItemSlugs(items) {
  const bySlug = countBy(items, (item) => item.slug);
  for (const item of items) {
    if (bySlug.get(item.slug) !== 1) {
      throw new Error(`Curation produced duplicate item slug: ${item.slug}`);
    }
  }
}

function evidenceKind(url, itemType) {
  const hostname = new URL(url).hostname;
  if (
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "brighttalk.com" ||
    hostname.endsWith(".brighttalk.com")
  ) {
    return "video";
  }
  if (hostname === "github.com" || hostname === "pypi.org") return "repository";
  if (itemType === "profile") return "profile";
  return "web_page";
}

export function buildPublicEvidence(items, capturedAt) {
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

export function buildOrganizations(rows, curation) {
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

function itemByTitle(items, title, type) {
  return items.find(
    (item) =>
      item.title.toLowerCase() === title.toLowerCase() &&
      (!type || item.type === type),
  );
}

function typePriority(item) {
  const index = TYPE_ORDER.indexOf(item.type);
  return index === -1 ? TYPE_ORDER.length : index;
}

export function buildRelations(items, curation) {
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
