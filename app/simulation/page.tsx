import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/simulation/Conversation";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";
import { searchConversationSources } from "@/lib/simulation/conversation-contract";
import { simulationExperienceMode } from "@/lib/server/simulation/mode";
import { runtimeValue } from "@/lib/server/runtime-env";
import { getPublicContentView } from "@/lib/server/public-content";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { conversationSources } from "@/lib/server/simulation/conversation/grounding";
import { conversationSourceAllowed } from "@/lib/server/simulation/conversation/screening";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return publicPageMetadata({
    title: SITE_COPY.simulation["seo-title"],
    description: SITE_COPY.simulation["seo-description"],
    path: "/simulation",
    noindex: true,
  });
}
export default async function SimulationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (simulationExperienceMode() !== "conversation-v2") notFound();
  const preview = runtimeValue("DEPLOYMENT_TIER") === "preview";
  if (!preview && !(await authorizeOwnerApi()).ok) notFound();
  const { bundle } = await getPublicContentView();
  const catalog = conversationSources(bundle).filter((card) =>
    conversationSourceAllowed(`${card.title} ${card.text} ${card.limit ?? ""}`),
  );
  const prompts = [
    SITE_COPY.simulation["prompt-tools"],
    SITE_COPY.simulation["prompt-evaluation"],
    SITE_COPY.simulation["prompt-teaching"],
  ];
  const choices = prompts.flatMap((label) => {
    const card = searchConversationSources(
      catalog.filter((card) => card.id.startsWith("group:")),
      label,
    )[0];
    return card ? [{ label, sourceId: card.id }] : [];
  });
  // Only fixed source IDs are accepted in URLs. Visitor questions never are.
  const query = await searchParams;
  const selected =
    typeof query.inspect === "string" &&
    choices.some((choice) => choice.sourceId === query.inspect)
      ? catalog.find((card) => card.id === query.inspect)
      : null;
  const initialCards = selected
    ? [selected]
    : [...new Set(choices.map((choice) => choice.sourceId))].flatMap(
        (id) => catalog.find((card) => card.id === id) ?? [],
      );
  return (
    <main id="main">
      <Conversation
        initialCards={initialCards}
        choices={choices}
        initialInspected={selected ? [selected.id] : []}
        previewCatalog={preview ? catalog : null}
      />
    </main>
  );
}
