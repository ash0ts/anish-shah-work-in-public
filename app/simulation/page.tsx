import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SimulationCampaign } from "@/components/simulation/SimulationCampaign";
import { SimulationDossier } from "@/components/simulation/SimulationDossier";
import { resolveSimulationDossier } from "@/components/simulation/resolve-dossier";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";
import { simulationExperienceEnabled } from "@/lib/server/simulation/policy";
import { getPublicContentView } from "@/lib/server/public-content";
import styles from "./simulation.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return publicPageMetadata({
    title: SITE_COPY.simulation["seo-title"],
    description: SITE_COPY.simulation["seo-description"],
    path: "/simulation",
  });
}

export default async function SimulationPage() {
  if (!simulationExperienceEnabled()) notFound();

  const publication = await getPublicContentView();
  const dossier = resolveSimulationDossier(
    publication.bundle,
    publication.source,
  );

  if (dossier.scenes.length !== 4 || dossier.facts.length < 8) notFound();

  return (
    <main className={`site-main ${styles.page}`} id="main">
      <SimulationCampaign dossier={dossier} />
      <noscript>
        <style>{`[data-simulation-interactive] { display: none !important; }`}</style>
        <p className={styles.noScriptNotice}>
          {SITE_COPY.simulation["noscript-summary"]}
        </p>
      </noscript>
      <SimulationDossier dossier={dossier} />
    </main>
  );
}
