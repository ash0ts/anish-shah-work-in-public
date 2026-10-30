import manifestJson from "@/content/presentation/home-overview.v2.json" with {
  type: "json",
};
import { workArchiveRecordsFrom } from "@/lib/work-index";
import { workBuckets } from "@/lib/work-groups";
import type { AnishContentBundle, WorkBucket } from "@/types/content";

export type HomeSignalIconId =
  | "tool-interface"
  | "open-book"
  | "program-network";

export type HomeIllustrationId = "terminal" | "notebook" | "study" | "presentation";

export type HomeSignalSpec = {
  id: "deployed" | "taught" | "programs";
  theme: "product" | "learning" | "programs";
  metricId: string;
  iconId: HomeSignalIconId;
  compactLimit: string;
};

type HomeAreaSpec = {
  bucketId: WorkBucket;
  illustrationId: HomeIllustrationId;
};

type HomePresentationManifest = {
  schemaVersion: "2.0";
  signals: HomeSignalSpec[];
  areas: HomeAreaSpec[];
};

export type HomeWorkArea = {
  id: WorkBucket;
  title: string;
  illustrationId: HomeIllustrationId;
  href: string;
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

const reviewedAreas = [
  { bucketId: "products-open-source", illustrationId: "terminal" },
  { bucketId: "courses-learning", illustrationId: "notebook" },
  { bucketId: "writing-research", illustrationId: "study" },
  { bucketId: "talks-programs", illustrationId: "presentation" },
] as const satisfies readonly HomeAreaSpec[];

const signalIds = new Set(reviewedSignals.map(({ id }) => id));
const signalThemes = new Set(reviewedSignals.map(({ theme }) => theme));
const signalIconIds = new Set<HomeSignalIconId>([
  "tool-interface",
  "open-book",
  "program-network",
]);

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
    !exactKeys(manifest, ["schemaVersion", "signals", "areas"]) ||
    manifest.schemaVersion !== "2.0" ||
    !Array.isArray(manifest.signals) ||
    manifest.signals.length !== 3 ||
    !Array.isArray(manifest.areas) ||
    manifest.areas.length !== workBuckets.length
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

  const areas = manifest.areas.map((value, index): HomeAreaSpec => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("home_area_spec_invalid");
    }
    const area = value as Record<string, unknown>;
    const reviewed = reviewedAreas[index];
    if (
      !exactKeys(area, ["bucketId", "illustrationId"]) ||
      !reviewed || area.bucketId !== reviewed.bucketId ||
      area.illustrationId !== reviewed.illustrationId
    ) {
      throw new Error("home_area_spec_unreviewed");
    }
    return { ...reviewed };
  });

  if (
    new Set(signals.map(({ id }) => id)).size !== signals.length ||
    new Set(signals.map(({ metricId }) => metricId)).size !== signals.length ||
    new Set(areas.map(({ bucketId }) => bucketId)).size !== areas.length
  ) {
    throw new Error("home_presentation_manifest_duplicate");
  }

  for (const [index, reviewed] of reviewedSignals.entries()) {
    if (signals[index]?.id !== reviewed.id) {
      throw new Error("home_signal_order_invalid");
    }
  }
  return { schemaVersion: "2.0", signals, areas };
}

export const homePresentationManifest =
  parseHomePresentationManifest(manifestJson);

export function homeWorkAreasFrom(bundle: AnishContentBundle): HomeWorkArea[] {
  const records = workArchiveRecordsFrom(bundle);
  return homePresentationManifest.areas.flatMap((spec) => {
    const bucket = workBuckets.find(({ id }) => id === spec.bucketId);
    if (!bucket) throw new Error("home_area_bucket_missing");
    if (!records.some((record) => record.bucket === bucket.id)) return [];
    return [{
      id: bucket.id,
      title: bucket.title,
      illustrationId: spec.illustrationId,
      href: `/work?bucket=${bucket.id}#work-index`,
    }];
  });
}
