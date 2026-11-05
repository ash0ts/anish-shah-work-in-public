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
import { headers } from "next/headers";
import {
  hasNetworkAccess,
  readNetworkAccess,
} from "@/lib/server/simulation/conversation/access";
import { NetworkGate } from "@/components/simulation/NetworkGate";
import { readGeminiConfiguration } from "@/lib/server/simulation/conversation/settings";

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
}: { searchParams?: Promise<{ access?: string }> } = {}) {
  if (simulationExperienceMode() !== "conversation-v2") notFound();
  const synthetic = runtimeValue("DEPLOYMENT_TIER") === "preview";
  const denied = (await searchParams)?.access === "denied";
  let geminiReady = false;
  let passwordProtected = false;
  if (!synthetic) {
    const gate = await readNetworkAccess();
    if (
      gate ||
      ["production", "staging"].includes(runtimeValue("DEPLOYMENT_TIER") ?? "")
    ) {
      if (!(await hasNetworkAccess((await headers()).get("cookie") ?? "")))
        return (
          <main id="main">
            <NetworkGate denied={denied} />
          </main>
        );
      passwordProtected = true;
    } else if (!(await authorizeOwnerApi()).ok)
      return (
        <main id="main">
          <NetworkGate denied={denied} />
        </main>
      );
    const config = await readGeminiConfiguration();
    geminiReady =
      config.tested && config.enabled && (await authorizeOwnerApi()).ok;
  }
  const { bundle } = await getPublicContentView();
  const { catalog, featuredIds } = personalInternetFrom(bundle);
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
        geminiReady={geminiReady}
        passwordProtected={passwordProtected}
      />
    </main>
  );
}
