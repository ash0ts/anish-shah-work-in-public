import chapterManifestJson from "@/content/presentation/career-chapters.v1.json";
import publicBundleJson from "@/content/public/anish-content.public.v1.json";
import type {
  AnishContentBundle,
  CanonicalEntity,
  PortfolioItem,
} from "@/types/content";

export type CareerChapterId =
  | "operational-ml"
  | "generative-systems"
  | "evaluation-loop"
  | "agents-adoption"
  | "agent-native-product";

export type CareerChapter = {
  id: CareerChapterId;
  period: string;
  title: string;
  statement: string;
  workIds: string[];
};

type CareerChapterManifest = {
  schemaVersion: "1.0";
  chapters: CareerChapter[];
  workLabels: Record<string, string>;
};

export type CareerChapterWork = {
  id: string;
  slug: string;
  label: string;
  canonicalTitle: string;
  role: string;
  year: number | null;
};

export type ResolvedCareerChapter = Omit<CareerChapter, "workIds"> & {
  works: CareerChapterWork[];
};

export type ResolvedCareerChapters = {
  chapters: ResolvedCareerChapter[];
  defaultChapterId: CareerChapterId | null;
  canEnhanceWithThree: boolean;
};

const manifest = chapterManifestJson as CareerChapterManifest;
const staticPublicBundle = publicBundleJson as AnishContentBundle;
const expectedIds: CareerChapterId[] = [
  "operational-ml",
  "generative-systems",
  "evaluation-loop",
  "agents-adoption",
  "agent-native-product",
];

function programRole(
  bundle: AnishContentBundle,
  entity: CanonicalEntity,
): string {
  if (entity.role !== "Program context") return entity.role;
  const itemById = new Map(bundle.items.map((item) => [item.id, item]));
  const primary =
    (entity.primaryItemId ? itemById.get(entity.primaryItemId) : undefined) ??
    entity.itemIds.map((id) => itemById.get(id)).find(Boolean);
  return primary?.role ?? entity.role;
}

function validateManifest(
  candidate: CareerChapterManifest,
  bundle: AnishContentBundle,
) {
  if (candidate.schemaVersion !== "1.0") {
    throw new Error("Unsupported Career Chapters manifest version.");
  }
  if (
    candidate.chapters.length !== expectedIds.length ||
    candidate.chapters.some((chapter, index) => chapter.id !== expectedIds[index])
  ) {
    throw new Error(
      "Career Chapters must contain the five chronological chapter IDs.",
    );
  }

  const entityById = new Map(bundle.entities.map((entity) => [entity.id, entity]));
  const workIds = candidate.chapters.flatMap((chapter) => chapter.workIds);
  if (new Set(workIds).size !== 12 || workIds.length !== 12) {
    throw new Error("Career Chapters must reference twelve unique anchors.");
  }

  for (const chapter of candidate.chapters) {
    if (
      !chapter.period.trim() ||
      !chapter.title.trim() ||
      !chapter.statement.trim() ||
      !chapter.workIds.length
    ) {
      throw new Error(`Career Chapter ${chapter.id} is incomplete.`);
    }
    for (const id of chapter.workIds) {
      const entity = entityById.get(id);
      if (!entity || entity.publicationState !== "public") {
        throw new Error(`Career Chapter anchor ${id} is not publicly resolvable.`);
      }
      if (!candidate.workLabels[id]?.trim()) {
        throw new Error(`Career Chapter anchor ${id} has no curated label.`);
      }
    }
  }
}

// Validate against the complete sanitized bundle once. A published D1 snapshot
// may intentionally omit an anchor later; that is handled as visibility below.
validateManifest(manifest, staticPublicBundle);

function visibleEntity(
  bundle: AnishContentBundle,
  entity: CanonicalEntity | undefined,
  publicItemIds: Set<string>,
): entity is CanonicalEntity {
  return Boolean(
    entity &&
      entity.publicationState === "public" &&
      entity.itemIds.some((id) => publicItemIds.has(id)),
  );
}

export function resolveCareerChapters(
  bundle: AnishContentBundle,
): ResolvedCareerChapters {
  const entityById = new Map(bundle.entities.map((entity) => [entity.id, entity]));
  const publicItems = bundle.items.filter(
    (item): item is PortfolioItem => item.publicationState === "public",
  );
  const publicItemIds = new Set(publicItems.map((item) => item.id));

  const chapters = manifest.chapters.flatMap(
    (chapter): ResolvedCareerChapter[] => {
      const works = chapter.workIds.flatMap((id): CareerChapterWork[] => {
        const entity = entityById.get(id);
        if (!visibleEntity(bundle, entity, publicItemIds)) return [];
        return [
          {
            id: entity.id,
            slug: entity.slug,
            label: manifest.workLabels[id],
            canonicalTitle: entity.displayTitle,
            role: programRole(bundle, entity),
            year: entity.year,
          },
        ];
      });
      return works.length
        ? [
            {
              id: chapter.id,
              period: chapter.period,
              title: chapter.title,
              statement: chapter.statement,
              works,
            },
          ]
        : [];
    },
  );

  return {
    chapters,
    defaultChapterId: chapters.at(-1)?.id ?? null,
    canEnhanceWithThree: chapters.length >= 3,
  };
}
