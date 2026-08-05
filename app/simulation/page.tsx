import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SimulationComingSoon } from "@/components/simulation/SimulationComingSoon";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";
import { simulationExperienceMode } from "@/lib/server/simulation/mode";
import styles from "./simulation.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const mode = simulationExperienceMode();
  return publicPageMetadata({
    title: SITE_COPY.simulation["seo-title"],
    description:
      mode === "coming-soon"
        ? SITE_COPY.simulation["coming-soon-seo-description"]
        : SITE_COPY.simulation["seo-description"],
    path: "/simulation",
    noindex: mode !== "campaign-v1",
  });
}

export default async function SimulationPage() {
  const mode = simulationExperienceMode();
  if (mode === "disabled") notFound();

  if (mode === "coming-soon") {
    return (
      <main className={`site-main ${styles.page}`} id="main">
        <SimulationComingSoon />
      </main>
    );
  }

  const [
    { SimulationCampaign },
    { SimulationDossier },
    { resolveSimulationDossier },
    { getPublicContentView },
  ] = await Promise.all([
    import("@/components/simulation/SimulationCampaign"),
    import("@/components/simulation/SimulationDossier"),
    import("@/components/simulation/resolve-dossier"),
    import("@/lib/server/public-content"),
  ]);

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
