import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PUBLIC_PATH = path.join(
  PROJECT_ROOT,
  "content/public/anish-content.public.v1.json",
);
const OWNER_PATH = path.join(
  PROJECT_ROOT,
  "content/private/anish-content.v1.json",
);
const publicBundle = JSON.parse(readFileSync(PUBLIC_PATH, "utf8"));
const ownerBundle = existsSync(OWNER_PATH)
  ? JSON.parse(readFileSync(OWNER_PATH, "utf8"))
  : null;

const groupsById = new Map(
  publicBundle.workGroups.map((group) => [group.id, group]),
);
const entitiesById = new Map(
  publicBundle.entities.map((entity) => [entity.id, entity]),
);

test("public WorkGroups compress the archive into four stable buckets", () => {
  assert.equal(publicBundle.schemaVersion, "1.2");
  assert.equal(publicBundle.workGroups.length, 88);
  assert.deepEqual(
    Object.fromEntries(
      [
        "products-open-source",
        "courses-learning",
        "writing-research",
        "talks-programs",
      ].map((bucket) => [
        bucket,
        publicBundle.workGroups.filter((group) => group.bucket === bucket)
          .length,
      ]),
    ),
    {
      "products-open-source": 16,
      "courses-learning": 5,
      "writing-research": 23,
      "talks-programs": 44,
    },
  );
  assert.equal(
    new Set(publicBundle.workGroups.map((group) => group.slug)).size,
    publicBundle.workGroups.length,
  );
});

test("every eligible entity belongs to exactly one WorkGroup", () => {
  const eligible = publicBundle.entities.filter(
    (entity) =>
      entity.publicationState === "public" &&
      entity.countability === "unique_work",
  );
  assert.equal(eligible.length, 106);
  const memberships = new Map();
  for (const group of publicBundle.workGroups) {
    assert(group.memberEntityIds.includes(group.primaryEntityId), group.id);
    assert(group.roleSummary.trim(), group.id);
    assert(Object.hasOwn(group, "period"), group.id);
    for (const entityId of group.memberEntityIds) {
      memberships.set(entityId, (memberships.get(entityId) ?? 0) + 1);
    }
    const expectedItems = new Set(
      group.memberEntityIds.flatMap(
        (entityId) => entitiesById.get(entityId)?.itemIds ?? [],
      ),
    );
    assert.deepEqual(new Set(group.itemIds), expectedItems, group.id);
    for (const entityId of group.memberEntityIds) {
      const entity = entitiesById.get(entityId);
      assert(
        group.slug === entity.slug ||
          group.slugAliases.includes(entity.slug),
        `${group.id} does not preserve ${entity.slug}`,
      );
    }
  }
  for (const entity of eligible) {
    assert.equal(memberships.get(entity.id), 1, entity.id);
  }

  const evalForge = groupsById.get("group:products:evalforge");
  assert(evalForge);
  assert.deepEqual(evalForge.memberEntityIds, ["entity:wk-0003"]);
  assert.equal(entitiesById.get("entity:wk-0003")?.sourceBasis, "supplemental");
});

test("reviewed multi-entity WorkGroups use the exact curated memberships", () => {
  const expected = {
    "group:courses:ai-curriculum": [
      "entity:wk-fp-0065",
      "entity:wk-fp-0066",
      "entity:wk-fp-0067",
    ],
    "group:courses:agentic-llm-series": [
      "entity:oc-fp-0016",
      "entity:oc-fp-0017",
      "entity:oc-fp-0018",
      "entity:pg-0002",
    ],
    "group:courses:startup-school": [
      "entity:oc-fp-0036",
      "entity:oc-fp-0037",
      "entity:pg-0001",
    ],
    "group:talks:architecting-agents": [
      "entity:oc-fp-0041",
      "entity:oc-fp-0044",
      "entity:oc-fp-0045",
      "entity:oc-fp-0047",
    ],
    "group:talks:llm-agent-fine-tuning": [
      "entity:oc-fp-0010",
      "entity:oc-fp-0012",
    ],
    "group:talks:model-customization": [
      "entity:oc-fp-0035",
      "entity:oc-fp-0039",
    ],
    "group:talks:gradient-dissent": [
      "entity:wk-fp-0092",
      "entity:wk-fp-0124",
      "entity:wk-fp-0125",
      "entity:wk-fp-0126",
      "entity:wk-fp-0127",
    ],
    "group:products:diffusers-wandb": [
      "entity:ar-fp-0174",
      "entity:ar-fp-0175",
    ],
    "group:products:openai-cookbook": [
      "entity:ar-fp-0176",
      "entity:ar-fp-0177",
    ],
    "group:products:gpt-engineer": [
      "entity:ar-fp-0179",
      "entity:ar-fp-0180",
    ],
    "group:products:langchain-integrations": [
      "entity:ar-fp-0172",
      "entity:ar-fp-0173",
    ],
  };
  for (const [groupId, entityIds] of Object.entries(expected)) {
    assert.deepEqual(groupsById.get(groupId)?.memberEntityIds, entityIds, groupId);
  }
  assert.deepEqual(
    groupsById.get("group:products:lightning-fabric")?.memberEntityIds,
    ["entity:wk-0002"],
  );
  assert.equal(
    entitiesById.get("entity:wk-0002")?.itemIds.length,
    3,
  );
});

test("program siblings and references remain context, not duplicate works", () => {
  for (const group of publicBundle.workGroups) {
    assert(
      group.programEntityIds.every(
        (entityId) => entitiesById.get(entityId)?.kind === "program",
      ),
      group.id,
    );
    assert(
      group.contextEntityIds.every(
        (entityId) => entitiesById.get(entityId)?.kind !== "program",
      ),
      group.id,
    );
  }

  const groupFor = (entityId) =>
    publicBundle.workGroups.find((group) =>
      group.memberEntityIds.includes(entityId),
    );
  const architecting = groupFor("entity:oc-fp-0041");
  const secondFullyConnected = groupFor("entity:oc-fp-0042");
  assert.notEqual(architecting.id, secondFullyConnected.id);
  assert(architecting.programEntityIds.includes("entity:pg-0004"));
  assert(secondFullyConnected.programEntityIds.includes("entity:pg-0004"));

  const summitA = groupFor("entity:oc-fp-0027");
  const summitB = groupFor("entity:oc-fp-0028");
  assert.notEqual(summitA.id, summitB.id);
  assert(summitA.programEntityIds.includes("entity:pg-0003"));
  assert(summitB.programEntityIds.includes("entity:pg-0003"));

  const odsc = groupFor("entity:oc-fp-0002");
  assert(odsc.contextEntityIds.includes("entity:ar-fp-0100"));
  assert(
    !publicBundle.workGroups.some((group) =>
      group.memberEntityIds.includes("entity:ar-fp-0100"),
    ),
  );
  assert(
    groupsById
      .get("group:products:langchain-integrations")
      ?.contextEntityIds.includes("entity:ar-fp-0103"),
  );
});

test("featured groups are ranked only within their bucket", () => {
  const expected = {
    "products-open-source": [
      "group:products:wandb-mcp",
      "group:products:evalforge",
      "group:products:lightning-fabric",
    ],
    "courses-learning": [
      "group:courses:ai-curriculum",
      "group:courses:agentic-llm-series",
      "group:courses:startup-school",
    ],
    "writing-research": [
      "group:writing:wandbot",
      "group:writing:prompt-engineering-langchain",
      "group:writing:automated-pdf-summarization",
    ],
    "talks-programs": [
      "group:talks:architecting-agents",
      "group:talks:llm-agent-fine-tuning",
      "group:talks:building-evaluating-agents",
    ],
  };
  for (const [bucket, ids] of Object.entries(expected)) {
    const actual = publicBundle.workGroups
      .filter((group) => group.bucket === bucket && group.featuredOrder !== null)
      .sort((left, right) => left.featuredOrder - right.featuredOrder)
      .map((group) => group.id);
    assert.deepEqual(actual, ids, bucket);
  }
});

test("metric presentation groups use the selected replacement checkpoints", () => {
  assert.equal(publicBundle.metrics.length, 17);
  assert.deepEqual(
    publicBundle.metricGroups.map((group) => group.theme),
    ["learning", "product", "programs", "archive"],
  );
  assert.equal(
    publicBundle.metricGroups.find((group) => group.theme === "product")
      ?.leadMetricId,
    "metric:project:wandb-mcp-server:tool-calls:2026-10-22",
  );
  assert.equal(
    publicBundle.metricGroups.find((group) => group.theme === "programs")
      ?.leadMetricId,
    "metric:events:pipeline-supported:2024-2025",
  );
  assert(
    !publicBundle.metrics.some(
      (metric) =>
        metric.id ===
          "metric:project:wandb-mcp-server:tool-calls:2026-06-11" ||
        metric.id === "metric:events:pipeline-supported:2025",
    ),
  );
  const calls = publicBundle.metrics.find(
    (metric) =>
      metric.id ===
      "metric:project:wandb-mcp-server:tool-calls:2026-10-22",
  );
  assert.deepEqual(
    {
      displayValue: calls?.displayValue,
      label: calls?.label,
      qualifier: calls?.qualifier,
      period: calls?.period,
      scope: calls?.scope,
      attribution: calls?.attribution,
      evidence: calls?.publicEvidenceIds,
    },
    {
      displayValue: "745K+",
      label: "cumulative MCP tool calls",
      qualifier:
        "Owner-validated cumulative tool calls, not HTTP requests or sessions. Direct project usage, not revenue; review date is not a measurement cutoff.",
      period: {
        start: null,
        end: null,
        asOf: "2026-10-22",
        label: "Owner-reviewed October 22, 2026",
      },
      scope: "work",
      attribution: "direct",
      evidence: ["evidence:methodology:internal-analytics"],
    },
  );
  const pipeline = publicBundle.metrics.find(
    (metric) => metric.id === "metric:events:pipeline-supported:2024-2025",
  );
  assert.deepEqual(
    {
      displayValue: pipeline?.displayValue,
      label: pipeline?.label,
      qualifier: pipeline?.qualifier,
      period: pipeline?.period,
      scope: pipeline?.scope,
      attribution: pipeline?.attribution,
      evidence: pipeline?.publicEvidenceIds,
    },
    {
      displayValue: "$4M+",
      label: "in supported event pipeline across tracked 2024–2025 programs",
      qualifier:
        "Supported pipeline across tracked event programs; not revenue, closed ARR, or personal attribution.",
      period: {
        start: "2024",
        end: "2025",
        asOf: "2025-10-01",
        label: "2024–2025",
      },
      scope: "portfolio",
      attribution: "associated",
      evidence: ["evidence:methodology:internal-analytics"],
    },
  );
  for (const metricId of [
    "metric:courses:enrollments:2026-07-30",
    "metric:courses:same-day-account-share:2026-07-30",
  ]) {
    const metric = publicBundle.metrics.find((candidate) => candidate.id === metricId);
    assert.equal(metric?.subjectId, "group:courses:ai-curriculum");
    assert.equal(metric?.scope, "work");
    assert.equal(metric?.attribution, "direct");
    assert(metric?.displaySurfaces.includes("item_detail"));
  }
});

test(
  "owner ledger preserves duplicate adjudication and exact source observations",
  { skip: !ownerBundle },
  () => {
    assert.equal(ownerBundle.groupingLedger.repeatedTitleClusterCount, 23);
    assert.equal(ownerBundle.groupingLedger.repeatedUrlClusterCount, 44);
    assert.deepEqual(
      [
        ...new Set(
          ownerBundle.groupingLedger.entries.map((entry) => entry.decision),
        ),
      ].sort(),
      [
        "program_sibling",
        "reference_only",
        "same_occurrence_representation",
        "same_story",
        "standalone",
      ],
    );
    const sourceMetric = (item, key, date) =>
      ownerBundle.metrics.find(
        (metric) =>
          metric.label.startsWith(`${item} —`) &&
          metric.key === key &&
          metric.period.asOf === date &&
          Object.hasOwn(metric, "value"),
      );
    const exactCalls = sourceMetric(
      "W&B MCP Server",
      "all_time_tool_calls",
      "2026-07-29",
    )?.value;
    const tracked2024Pipeline = sourceMetric(
      "All tracked 2024 events",
      "pipeline_supported_usd",
      "2025-01-01",
    )?.value;
    const tracked2025Pipeline = sourceMetric(
      "All 2025 events (Anish core IC/organizer)",
      "pipeline_supported_usd",
      "2025-10-01",
    )?.value;
    assert.equal(typeof exactCalls, "number");
    assert.equal(typeof tracked2024Pipeline, "number");
    assert.equal(typeof tracked2025Pipeline, "number");
    assert(exactCalls >= 200_000);
    assert(tracked2024Pipeline + tracked2025Pipeline >= 4_000_000);
    const publicText = JSON.stringify(publicBundle);
    for (const exactValue of [
      exactCalls,
      tracked2024Pipeline,
      tracked2025Pipeline,
    ]) {
      assert(!publicText.includes(String(exactValue)));
    }
  },
);
