import { lazy, Suspense } from "react";
import styles from "@/app/simulation/simulation.module.css";
import { TacticalArena } from "../TacticalArena";
import type {
  ArenaProgress,
  SimulationDifficulty,
  SimulationMode,
  SimulationSceneId,
} from "../types";

const LazyActionArena = lazy(() => import("../ActionArena"));

export type ActionBridgeProps = {
  mode: SimulationMode;
  sceneId: SimulationSceneId;
  difficulty: SimulationDifficulty;
  onComplete: (progress: ArenaProgress) => void;
  onFeedback: (kind: "hit" | "evidence" | "near-miss" | "recalibrate") => void;
};

export function ActionBridge({
  mode,
  sceneId,
  difficulty,
  onComplete,
  onFeedback,
}: ActionBridgeProps) {
  if (mode === "action") {
    return (
      <Suspense
        fallback={
          <div className={styles.loadingArena} role="status">
            <span aria-hidden="true">◇</span>
            Loading the action channel…
          </div>
        }
      >
        <LazyActionArena
          key={`${sceneId}-${difficulty}`}
          sceneId={sceneId}
          difficulty={difficulty}
          onComplete={onComplete}
          onFeedback={onFeedback}
        />
      </Suspense>
    );
  }

  return (
    <TacticalArena
      key={`${sceneId}-${difficulty}`}
      sceneId={sceneId}
      difficulty={difficulty}
      onComplete={onComplete}
      onFeedback={onFeedback}
    />
  );
}
