import type { CampaignContext } from "./campaign-state";
import { CURIOSITY_COPY } from "./campaign-copy";
import type {
  SimulationFact,
  SimulationProviderDoorway,
} from "../types";

export type ConversationKey = {
  observations: SimulationFact[];
  workLinks: SimulationFact[];
  doorway: SimulationProviderDoorway | null;
  question: string;
};

export function buildConversationKey(
  context: CampaignContext,
): ConversationKey {
  const recovered = context.dossier.facts.filter((fact) =>
    context.revealedFactIds.includes(fact.id),
  );
  const candidates = recovered.length ? recovered : context.dossier.facts;
  return {
    observations: candidates.slice(0, 3),
    workLinks: (recovered.length > 1 ? recovered : context.dossier.facts).slice(
      0,
      2,
    ),
    doorway:
      context.dossier.providerDoorways.find(
        (candidate) =>
          candidate.label.toLowerCase() === context.selectedDoorway,
      ) ?? context.dossier.providerDoorways[0] ?? null,
    question: CURIOSITY_COPY[context.curiosity],
  };
}
