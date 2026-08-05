import styles from "@/app/simulation/simulation.module.css";
import type { ArenaProgress, SimulationDossier, SimulationSceneId } from "../types";
import type { CampaignContext } from "./campaign-state";
import { CURIOSITY_COPY } from "./campaign-copy";
import { ActionBridge } from "./ActionBridge";
import { DebriefPanel } from "./DebriefPanel";
import { OpponentPanel } from "./OpponentPanel";

export type EncounterPresentationProps = {
  dossier: SimulationDossier;
  context: CampaignContext;
  sceneId: SimulationSceneId;
  isWave: boolean;
  sceneTitle: string;
  onCompleteWave: (progress: ArenaProgress) => void;
  onArenaFeedback: (
    kind: "hit" | "evidence" | "near-miss" | "recalibrate",
  ) => void;
  onAdvance: (actionId: string, freeText?: string) => void;
};

export function EncounterPresentation({
  dossier,
  context,
  sceneId,
  isWave,
  sceneTitle,
  onCompleteWave,
  onArenaFeedback,
  onAdvance,
}: EncounterPresentationProps) {
  return (
    <div className={styles.gameLayout}>
      <aside className={styles.signalLedger} aria-label="Campaign status">
        <p>{sceneTitle}</p>
        <dl>
          <div>
            <dt>Mode</dt>
            <dd>{context.mode}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{context.difficulty}</dd>
          </div>
          <div>
            <dt>Signal</dt>
            <dd>{context.scores.signalFound}</dd>
          </div>
          <div>
            <dt>Grounded</dt>
            <dd>{context.scores.claimsGrounded}</dd>
          </div>
          <div>
            <dt>Recalibrations</dt>
            <dd>{context.recalibrations}</dd>
          </div>
        </dl>
        <p>{CURIOSITY_COPY[context.curiosity]}</p>
      </aside>

      <div
        aria-label={`${sceneTitle} ${isWave ? "encounter" : "debrief"}`}
        className={styles.encounterStage}
        data-simulation-stage
        role="region"
        tabIndex={-1}
      >
        {isWave ? (
          <ActionBridge
            mode={context.mode}
            sceneId={sceneId}
            difficulty={context.difficulty}
            onComplete={onCompleteWave}
            onFeedback={onArenaFeedback}
          />
        ) : (
          <DebriefPanel
            dossier={dossier}
            sceneId={sceneId}
            pending={context.pendingTurns > 0}
            onAdvance={onAdvance}
          />
        )}
      </div>

      <OpponentPanel context={context} />
    </div>
  );
}
