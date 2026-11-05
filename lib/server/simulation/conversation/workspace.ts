import type { AnishContentBundle } from "@/types/content";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import { workFacetsForRecord, workThemeFacetLabel } from "@/lib/work-facets";
import type { InternetObject } from "@/lib/simulation/personal-internet";
import { conversationSources } from "./grounding";
import { conversationSourceAllowed } from "./screening";
import presentation from "@/content/presentation/simulation.v1.json";

/** Only the active public Work projection enters the visual slice. No collections. */
export function personalInternetFrom(bundle: AnishContentBundle) {
  const publicGroups = new Set(
    bundle.workGroups
      .filter((group) => group.publicationState === "public")
      .map((group) => group.id),
  );
  const sources = new Map(
    conversationSources(bundle).map((source) => [source.id, source]),
  );
  const catalog: InternetObject[] = workArchiveRecordsFrom(bundle).flatMap(
    (work) => {
      const source = sources.get(work.id);
      if (
        !publicGroups.has(work.id) ||
        !source ||
        !conversationSourceAllowed(`${source.title} ${source.text}`)
      )
        return [];
      const kind =
        work.bucket === "courses-learning"
          ? "notebook"
          : work.bucket === "writing-research"
            ? "document"
            : work.bucket === "talks-programs"
              ? "poster"
              : "terminal";
      return [
        {
          ...source,
          label: work.shortTitle,
          kind,
          topics: workFacetsForRecord(work).theme.map((id) => ({
            id,
            label: workThemeFacetLabel(id),
          })),
        },
      ];
    },
  );
  const visible = new Set(catalog.map((object) => object.id));
  const featuredIds = presentation.workspace.objectIds.filter((id) =>
    visible.has(id),
  );
  return { catalog, featuredIds };
}
