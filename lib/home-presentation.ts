import manifestJson from "@/content/presentation/home-signal-rails.v1.json" with {
  type: "json",
};
import { workArchiveRecordsFrom } from "@/lib/work-index";
import {
  themeFacetDefinitions,
  workFacetsForRecord,
  type ThemeFacetId,
} from "@/lib/work-facets";
import { workBuckets } from "@/lib/work-groups";
import type { AnishContentBundle, WorkBucket } from "@/types/content";

export type HomeSignalIconId =
  | "tool-interface"
  | "open-book"
  | "program-network";

export type HomeRailIconId =
  | "tool-node"
  | "learning-loop"
  | "research-trace"
  | "program-broadcast";

export type HomeSignalSpec = {
  id: "deployed" | "taught" | "programs";
  theme: "product" | "learning" | "programs";
  metricId: string;
  iconId: HomeSignalIconId;
  compactLimit: string;
};

type HomeRailSpec = {
  bucketId: WorkBucket;
  iconId: HomeRailIconId;
  topicIds: ThemeFacetId[];
};

type HomePresentationManifest = {
  schemaVersion: "1.0";
  signals: HomeSignalSpec[];
  rails: HomeRailSpec[];
};

export type HomeTopicRail = {
  id: WorkBucket;
  title: string;
  iconId: HomeRailIconId;
  projectCount: number;
  href: string;
  topics: Array<{
    id: ThemeFacetId;
    label: string;
    count: number;
    href: string;
  }>;
};

const reviewedSignals = [
  {
    id: "deployed",
    theme: "product",
    metricId: "metric:project:wandb-mcp-server:tool-calls:2026-10-22",
    iconId: "tool-interface",
    compactLimit: "Direct project usage · not revenue",
  },
  {
    id: "taught",
    theme: "learning",
    metricId: "metric:courses:enrollments:2026-07-30",
    iconId: "open-book",
    compactLimit: "Enrollments · not unique learners",
  },
  {
    id: "programs",
    theme: "programs",
    metricId: "metric:events:pipeline-supported:2024-2025",
    iconId: "program-network",
    compactLimit: "Supported pipeline · not revenue",
  },
] as const satisfies readonly HomeSignalSpec[];

const reviewedRails = [
  {
    bucketId: "products-open-source",
    iconId: "tool-node",
    topicIds: [
      "agent-systems",
      "evaluation-observability",
      "open-source-ecosystems",
    ],
  },
  {
    bucketId: "courses-learning",
    iconId: "learning-loop",
    topicIds: [
      "agent-systems",
      "foundation-models",
      "evaluation-observability",
    ],
  },
  {
    bucketId: "writing-research",
    iconId: "research-trace",
    topicIds: [
      "foundation-models",
      "ml-systems-infrastructure",
      "evaluation-observability",
    ],
  },
  {
    bucketId: "talks-programs",
    iconId: "program-broadcast",
    topicIds: [
      "agent-systems",
      "education-community",
      "ml-systems-infrastructure",
    ],
  },
] as const satisfies readonly HomeRailSpec[];

const signalIds = new Set(reviewedSignals.map(({ id }) => id));
const signalThemes = new Set(reviewedSignals.map(({ theme }) => theme));
const signalIconIds = new Set<HomeSignalIconId>([
  "tool-interface",
  "open-book",
  "program-network",
]);
const railIconIds = new Set<HomeRailIconId>([
  "tool-node",
  "learning-loop",
  "research-trace",
  "program-broadcast",
]);
const bucketIds = new Set(workBuckets.map(({ id }) => id));
const topicDefinitions = new Map(
  themeFacetDefinitions.map((definition) => [definition.id, definition]),
);

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  return (
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

export function parseHomePresentationManifest(
  value: unknown,
): HomePresentationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("home_presentation_manifest_invalid");
  }
  const manifest = value as Record<string, unknown>;
  if (
    !exactKeys(manifest, ["schemaVersion", "signals", "rails"]) ||
    manifest.schemaVersion !== "1.0" ||
    !Array.isArray(manifest.signals) ||
    manifest.signals.length !== 3 ||
    !Array.isArray(manifest.rails) ||
    manifest.rails.length !== workBuckets.length
  ) {
    throw new Error("home_presentation_manifest_invalid");
  }

  const signals = manifest.signals.map((value): HomeSignalSpec => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("home_signal_spec_invalid");
    }
    const signal = value as Record<string, unknown>;
    if (
      !exactKeys(signal, [
        "id",
        "theme",
        "metricId",
        "iconId",
        "compactLimit",
      ]) ||
      typeof signal.id !== "string" ||
      !signalIds.has(signal.id as HomeSignalSpec["id"]) ||
      typeof signal.theme !== "string" ||
      !signalThemes.has(signal.theme as HomeSignalSpec["theme"]) ||
      typeof signal.metricId !== "string" ||
      !/^metric:[a-z0-9:-]+$/.test(signal.metricId) ||
      typeof signal.iconId !== "string" ||
      !signalIconIds.has(signal.iconId as HomeSignalIconId) ||
      typeof signal.compactLimit !== "string" ||
      signal.compactLimit.length < 8 ||
      signal.compactLimit.length > 64
    ) {
      throw new Error("home_signal_spec_invalid");
    }
    const reviewed = reviewedSignals.find(({ id }) => id === signal.id);
    if (
      !reviewed ||
      signal.theme !== reviewed.theme ||
      signal.metricId !== reviewed.metricId ||
      signal.iconId !== reviewed.iconId ||
      signal.compactLimit !== reviewed.compactLimit
    ) {
      throw new Error("home_signal_spec_unreviewed");
    }
    return { ...reviewed };
  });

  const rails = manifest.rails.map((value): HomeRailSpec => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("home_rail_spec_invalid");
    }
    const rail = value as Record<string, unknown>;
    if (
      !exactKeys(rail, ["bucketId", "iconId", "topicIds"]) ||
      typeof rail.bucketId !== "string" ||
      !bucketIds.has(rail.bucketId as WorkBucket) ||
      typeof rail.iconId !== "string" ||
      !railIconIds.has(rail.iconId as HomeRailIconId) ||
      !Array.isArray(rail.topicIds) ||
      rail.topicIds.length < 1 ||
      rail.topicIds.length > 3 ||
      rail.topicIds.some(
        (topicId) =>
          typeof topicId !== "string" ||
          !topicDefinitions.has(topicId as ThemeFacetId),
      ) ||
      new Set(rail.topicIds).size !== rail.topicIds.length
    ) {
      throw new Error("home_rail_spec_invalid");
    }
    return {
      bucketId: rail.bucketId as WorkBucket,
      iconId: rail.iconId as HomeRailIconId,
      topicIds: rail.topicIds as ThemeFacetId[],
    };
  });

  if (
    new Set(signals.map(({ id }) => id)).size !== signals.length ||
    new Set(signals.map(({ metricId }) => metricId)).size !== signals.length ||
    new Set(rails.map(({ bucketId }) => bucketId)).size !== rails.length
  ) {
    throw new Error("home_presentation_manifest_duplicate");
  }

  for (const [index, reviewed] of reviewedSignals.entries()) {
    if (signals[index]?.id !== reviewed.id) {
      throw new Error("home_signal_order_invalid");
    }
  }
  for (const [index, reviewed] of reviewedRails.entries()) {
    const rail = rails[index];
    if (
      !rail ||
      rail.bucketId !== reviewed.bucketId ||
      rail.iconId !== reviewed.iconId ||
      rail.topicIds.join("\u0000") !== reviewed.topicIds.join("\u0000")
    ) {
      throw new Error("home_rail_order_invalid");
    }
  }

  return { schemaVersion: "1.0", signals, rails };
}

export const homePresentationManifest =
  parseHomePresentationManifest(manifestJson);

export function homeTopicRailsFrom(
  bundle: AnishContentBundle,
): HomeTopicRail[] {
  const records = workArchiveRecordsFrom(bundle);
  return homePresentationManifest.rails.map((spec) => {
    const bucket = workBuckets.find(({ id }) => id === spec.bucketId);
    if (!bucket) throw new Error(`home_rail_bucket_missing:${spec.bucketId}`);
    const bucketRecords = records.filter(
      (record) => record.bucket === spec.bucketId,
    );
    return {
      id: bucket.id,
      title: bucket.title,
      iconId: spec.iconId,
      projectCount: bucketRecords.length,
      href: workScopeHref(bucket.id),
      topics: spec.topicIds.flatMap((topicId) => {
        const definition = topicDefinitions.get(topicId);
        if (!definition) return [];
        const count = bucketRecords.filter((record) =>
          workFacetsForRecord(record).theme.includes(topicId),
        ).length;
        if (!count) return [];
        return [
          {
            id: topicId,
            label: definition.label,
            count,
            href: workScopeHref(bucket.id, topicId),
          },
        ];
      }),
    };
  });
}

function workScopeHref(bucketId: WorkBucket, topicId?: ThemeFacetId) {
  const parameters = new URLSearchParams({ bucket: bucketId });
  if (topicId) parameters.set("topic", topicId);
  return `/work?${parameters.toString()}#work-index`;
}
