"use client";

import Link from "next/link";
import styles from "@/app/simulation/simulation.module.css";
import { BootSequence } from "./campaign/BootSequence";
import { EncounterPresentation } from "./campaign/EncounterPresentation";
import { EndingModelCard } from "./campaign/EndingModelCard";
import { useSimulationCampaignController } from "./campaign/use-simulation-campaign-controller";
import type { SimulationDossier } from "./types";

export function SimulationCampaign({ dossier }: { dossier: SimulationDossier }) {
  const campaign = useSimulationCampaignController(dossier);
  const isWave = campaign.stageKind === "wave";

  return (
    <div
      className={styles.campaign}
      data-simulation-interactive
      data-simulation-state={campaign.stateName}
    >
      <p
        className={styles.srAnnouncement}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {campaign.stateName === "boot"
          ? "Public model standby."
          : campaign.stateName === "ending"
            ? "Conversation Key assembled."
            : `${campaign.scene?.title ?? "Campaign"}: ${isWave ? "encounter" : "debrief"} ready.`}
      </p>
      <header className={styles.campaignHeader}>
        <Link href="/play" prefetch={false} onClick={campaign.exit}>
          <span aria-hidden="true">←</span> Room
        </Link>
        <div>
          <p>4N1SH // PUBLIC MODEL</p>
          <span>{dossier.persona.disclosure}</span>
        </div>
        <p>
          {campaign.stateName === "boot"
            ? "Standby"
            : `Sequence ${campaign.progressIndex}/9`}
        </p>
      </header>

      {campaign.stateName === "boot" ? (
        <BootSequence dossier={dossier} onStart={campaign.start} />
      ) : campaign.stateName === "ending" ? (
        <EndingModelCard
          context={campaign.context}
          onRestart={campaign.restart}
          onExit={campaign.exit}
        />
      ) : campaign.sceneId && campaign.scene ? (
        <EncounterPresentation
          dossier={dossier}
          context={campaign.context}
          sceneId={campaign.sceneId}
          sceneTitle={campaign.scene.title}
          isWave={isWave}
          onCompleteWave={campaign.completeWave}
          onArenaFeedback={campaign.arenaFeedback}
          onAdvance={campaign.advance}
        />
      ) : null}
    </div>
  );
}
