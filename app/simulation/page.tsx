import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/simulation/Conversation";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";
import { simulationExperienceMode } from "@/lib/server/simulation/mode";
import { runtimeValue } from "@/lib/server/runtime-env";
import { getPublicContentView } from "@/lib/server/public-content";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { personalInternetFrom } from "@/lib/server/simulation/conversation/workspace";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return publicPageMetadata({
    title: SITE_COPY.simulation["seo-title"],
    description: SITE_COPY.simulation["seo-description"],
    path: "/simulation",
    noindex: true,
  });
}
export default async function SimulationPage() {
  if (simulationExperienceMode() !== "conversation-v2") notFound();
  if (
    runtimeValue("DEPLOYMENT_TIER") !== "preview" &&
    !(await authorizeOwnerApi()).ok
  )
    notFound();
  const { bundle } = await getPublicContentView();
  return (
    <main id="main">
      <Conversation {...personalInternetFrom(bundle)} />
    </main>
  );
}
