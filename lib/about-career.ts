import manifest from "@/content/presentation/career.v1.json";
import { brandAssetForId, type BrandAsset } from "@/lib/brand-assets";

const careerPhaseIds = [
  "weights-and-biases",
  "sap-and-brilliant-hire",
  "temple-university",
] as const;

type CareerPhaseId = (typeof careerPhaseIds)[number];

export type CareerPhase = {
  id: CareerPhaseId;
  period: string;
  organization: string;
  track: string;
  mark: {
    label: string;
    asset: BrandAsset | null;
  };
};

function isCareerPhaseId(value: string): value is CareerPhaseId {
  return careerPhaseIds.some((id) => id === value);
}

/**
 * Resolves reviewed career structure against the Git-owned About copy. The
 * manifest deliberately carries no resume document, private profile field, or
 * remote runtime asset. Approved first-party artwork resolves through the
 * shared brand registry; missing artwork retains the typographic fallback.
 */
export function aboutCareerPhases(): readonly CareerPhase[] {
  if (manifest.schemaVersion !== "1.0" || manifest.phases.length !== 3) {
    throw new Error("The About career manifest must contain exactly three v1 phases.");
  }

  const seen = new Set<string>();
  return manifest.phases.map((phase) => {
    if (!isCareerPhaseId(phase.id) || seen.has(phase.id)) {
      throw new Error(`Invalid or duplicate About career phase: ${phase.id}`);
    }
    seen.add(phase.id);
    if (
      !phase.period.trim() ||
      !phase.organization.trim() ||
      !phase.track.trim() ||
      !phase.mark.label.trim() ||
      (phase.mark.kind !== "official" &&
        phase.mark.kind !== "typographic") ||
      (phase.mark.kind === "official" && !phase.mark.brandAssetId) ||
      (phase.mark.kind === "typographic" && phase.mark.brandAssetId !== null)
    ) {
      throw new Error(`Incomplete About career phase: ${phase.id}`);
    }

    return {
      id: phase.id,
      period: phase.period,
      organization: phase.organization,
      track: phase.track,
      mark: {
        label: phase.mark.label,
        asset: phase.mark.brandAssetId
          ? brandAssetForId(phase.mark.brandAssetId)
          : null,
      },
    };
  });
}
