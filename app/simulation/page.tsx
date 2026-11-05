import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Network } from "@/components/simulation/network/Network";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";
import { simulationExperienceMode } from "@/lib/server/simulation/mode";
import { runtimeValue } from "@/lib/server/runtime-env";
import { getPublicContentView } from "@/lib/server/public-content";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { personalInternetFrom } from "@/lib/server/simulation/conversation/workspace";
import { readSimulationCatalog } from "@/lib/server/simulation/conversation/catalog";
import { pageCatalog } from "@/lib/simulation/network/catalog-contract";

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
  const { catalog, featuredIds } = personalInternetFrom(bundle);
  const synthetic = runtimeValue("DEPLOYMENT_TIER") === "preview";
  const previewWork = catalog.map((item) => ({
    ...item,
    domain: "work" as const,
    version: "synthetic",
    updatedAt: null,
    stale: false,
    provenance: "Synthetic preview Work archive",
  }));
  previewWork.sort(
    (a, b) =>
      Number(featuredIds.includes(b.id)) - Number(featuredIds.includes(a.id)),
  );
  const initial = synthetic
    ? {
        ...pageCatalog(previewWork, "work", "", 1),
        fixture: true,
      }
    : await readSimulationCatalog("work");
  return (
    <main id="main">
      <Network
        initial={initial}
        featuredIds={featuredIds}
        synthetic={synthetic}
        previewWork={synthetic ? previewWork : []}
      />
    </main>
  );
}
