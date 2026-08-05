import manifest from "@/content/presentation/career.v1.json";
import { SITE_COPY } from "@/lib/copy";

const careerPhaseIds = [
  "weights-and-biases",
  "sap-and-brilliant-hire",
  "temple-university",
] as const;

type CareerPhaseId = (typeof careerPhaseIds)[number];
type CareerSummaryCopyKey =
  | "career-phase-1-summary"
  | "career-phase-2-summary"
  | "career-phase-3-summary";

export type CareerPhase = {
  id: CareerPhaseId;
  period: string;
  organization: string;
  track: string;
  summary: string;
  mark: {
    kind: "typographic";
    label: string;
  };
};

const summaryKeys = new Set<CareerSummaryCopyKey>([
  "career-phase-1-summary",
  "career-phase-2-summary",
  "career-phase-3-summary",
]);

function isCareerPhaseId(value: string): value is CareerPhaseId {
  return careerPhaseIds.some((id) => id === value);
}

function isCareerSummaryCopyKey(value: string): value is CareerSummaryCopyKey {
  return summaryKeys.has(value as CareerSummaryCopyKey);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolves reviewed career structure against the Git-owned About copy. The
 * manifest deliberately carries no resume document, private profile field, or
 * remote runtime asset; marks remain first-party typographic fallbacks until a
 * separately reviewed official asset is checked in.
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
      !isCareerSummaryCopyKey(phase.summaryCopyKey) ||
      phase.mark.kind !== "typographic" ||
      phase.mark.assetPath !== null ||
      !phase.mark.label.trim() ||
      !isHttpsUrl(phase.mark.sourceUrl) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(phase.mark.lastVerified)
    ) {
      throw new Error(`Incomplete About career phase: ${phase.id}`);
    }

    return {
      id: phase.id,
      period: phase.period,
      organization: phase.organization,
      track: phase.track,
      summary: SITE_COPY.about[phase.summaryCopyKey],
      mark: {
        kind: "typographic",
        label: phase.mark.label,
      },
    };
  });
}
