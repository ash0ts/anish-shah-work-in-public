/** Public collections, profile, narrative, and source-snapshot presentation. */
import { sha256 } from "./primitives.mjs";

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

function itemByTitle(items, title, type) {
  return items.find(
    (item) =>
      item.title.toLowerCase() === title.toLowerCase() &&
      (!type || item.type === type),
  );
}

export function buildCollections(items, publicMetrics) {
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

export function buildProfile(items) {
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

export function buildPublicNarratives() {
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
      id: "narrative:sources:method",
      title: "How to read the numbers",
      body: "Public counts come from the public inventory. Internal outcomes are deliberately rounded, dated, qualified, and separated from revenue or individual-causality claims.",
      placement: "sources",
      publicationState: "public",
    },
  ];
}

export function stripPrivateItemFields(item) {
  const publicItem = { ...item };
  delete publicItem.sourceRecord;
  return publicItem;
}

export function markFeatured(items, collection) {
  const selected = new Set(collection.itemIds);
  for (const item of items) item.featured = selected.has(item.id);
}

export function sourceSnapshot({
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
