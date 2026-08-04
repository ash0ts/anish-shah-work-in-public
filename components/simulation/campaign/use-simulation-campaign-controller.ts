import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useRef } from "react";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import {
  endSimulationSession,
  requestSimulationTurn,
  startSimulationSession,
} from "../simulation-client";
import {
  clearSimulationProgress,
  writeSimulationProgress,
} from "../simulation-progress";
import type {
  ArenaProgress,
  CuriosityVector,
  SimulationDifficulty,
  SimulationDossier,
  SimulationMode,
} from "../types";
import {
  campaignMachine,
  campaignProgressIndex,
  campaignSceneId,
  campaignStageKind,
  type CampaignContext,
  type CampaignStateName,
} from "./campaign-state";
import {
  arenaFeedbackAudioCue,
  campaignAudioCueForState,
  type ArenaFeedback,
} from "./campaign-audio";

export type CampaignController = {
  stateName: CampaignStateName;
  context: CampaignContext;
  sceneId: ReturnType<typeof campaignSceneId>;
  scene: SimulationDossier["scenes"][number] | null;
  stageKind: ReturnType<typeof campaignStageKind>;
  progressIndex: number;
  start: (
    mode: SimulationMode,
    difficulty: SimulationDifficulty,
    curiosity: CuriosityVector,
  ) => void;
  completeWave: (progress: ArenaProgress) => void;
  advance: (actionId: string, freeText?: string) => void;
  arenaFeedback: (kind: ArenaFeedback) => void;
  restart: () => void;
  exit: () => void;
};

export function useSimulationCampaignController(
  dossier: SimulationDossier,
): CampaignController {
  const audio = useExperienceAudio();
  const [snapshot, send] = useMachine(campaignMachine, { input: { dossier } });
  const stateName = String(snapshot.value) as CampaignStateName;
  const context = snapshot.context;
  const revisionRef = useRef(0);
  const turnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runEpochRef = useRef(0);
  const activeRequestsRef = useRef(new Set<AbortController>());
  const sceneId = campaignSceneId(stateName);
  const scene = sceneId
    ? dossier.scenes.find((candidate) => candidate.id === sceneId) ?? null
    : null;
  const stageKind = campaignStageKind(stateName);

  useEffect(() => {
    if (!audio.enabled) return;
    const cue = campaignAudioCueForState(stateName);
    if (cue) audio.playCue(cue);
  }, [audio, stateName]);

  useEffect(() => {
    revisionRef.current = context.revision;
  }, [context.revision]);

  useEffect(() => {
    if (stateName === "boot") {
      clearSimulationProgress();
      return;
    }

    writeSimulationProgress({
      campaignVersion: dossier.campaignVersion,
      stateName,
      mode: context.mode,
      difficulty: context.difficulty,
      curiosity: context.curiosity,
      revision: context.revision,
      revealedFactIds: context.revealedFactIds,
      visitorSignals: context.visitorSignals,
      selectedDoorway: context.selectedDoorway,
      scores: context.scores,
      recalibrations: context.recalibrations,
    });
  }, [context, dossier.campaignVersion, stateName]);

  useEffect(() => {
    if (stateName !== "ending" || context.pendingTurns > 0) return;
    clearSimulationProgress();
    void endSimulationSession();
  }, [context.pendingTurns, stateName]);

  useEffect(() => {
    const focusState = () => {
      const target =
        stateName === "boot"
          ? document.getElementById("simulation-boot-title")
          : stateName === "ending"
            ? document.getElementById("conversation-key-title")
            : document.querySelector<HTMLElement>("[data-simulation-stage]");
      target?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusState);
    return () => window.cancelAnimationFrame(frame);
  }, [stateName]);

  useEffect(
    () => () => {
      runEpochRef.current += 1;
      for (const controller of activeRequestsRef.current) controller.abort();
      activeRequestsRef.current.clear();
    },
    [],
  );

  const start = useCallback(
    (
      mode: SimulationMode,
      difficulty: SimulationDifficulty,
      curiosity: CuriosityVector,
    ) => {
      runEpochRef.current += 1;
      const runEpoch = runEpochRef.current;
      for (const active of activeRequestsRef.current) active.abort();
      activeRequestsRef.current.clear();
      const controller = new AbortController();
      activeRequestsRef.current.add(controller);
      send({ type: "START", mode, difficulty, curiosity });
      void startSimulationSession(
        mode,
        difficulty,
        curiosity,
        controller.signal,
      ).then((revision) => {
        activeRequestsRef.current.delete(controller);
        if (runEpoch !== runEpochRef.current || controller.signal.aborted) return;
        revisionRef.current = Math.max(revisionRef.current, revision);
        send({ type: "SESSION_READY", revision: revisionRef.current });
      });
    },
    [send],
  );

  const completeWave = useCallback(
    (progress: ArenaProgress) => {
      if (sceneId === "boss") audio.playCue("simulation-victory");
      send({ type: "WAVE_COMPLETE", progress });
    },
    [audio, sceneId, send],
  );

  const advance = useCallback(
    (actionId: string, freeText?: string) => {
      if (!sceneId) return;
      audio.playCue("simulation-action");
      send({ type: "TURN_REQUESTED" });
      send({ type: "ADVANCE", sceneId, actionId });
      const runEpoch = runEpochRef.current;
      turnQueueRef.current = turnQueueRef.current.then(async () => {
        if (runEpoch !== runEpochRef.current) return;
        const controller = new AbortController();
        activeRequestsRef.current.add(controller);
        const requestId = crypto.randomUUID();
        const response = await requestSimulationTurn(
          dossier,
          {
            requestId,
            revision: revisionRef.current,
            sceneId,
            actionId,
            ...(freeText ? { freeText } : {}),
          },
          controller.signal,
        );
        activeRequestsRef.current.delete(controller);
        if (runEpoch !== runEpochRef.current || controller.signal.aborted) return;
        revisionRef.current = response.revision;
        send({ type: "TURN_RESOLVED", response });
        audio.playCue(
          response.source === "authored_fallback"
            ? "simulation-fallback"
            : "simulation-dialogue-ready",
        );
      });
    },
    [audio, dossier, sceneId, send],
  );

  const arenaFeedback = useCallback(
    (kind: ArenaFeedback) => {
      audio.playCue(arenaFeedbackAudioCue(kind));
    },
    [audio],
  );

  const restart = useCallback(() => {
    runEpochRef.current += 1;
    for (const controller of activeRequestsRef.current) controller.abort();
    activeRequestsRef.current.clear();
    void endSimulationSession();
    clearSimulationProgress();
    revisionRef.current = 0;
    turnQueueRef.current = Promise.resolve();
    send({ type: "RESET" });
    window.requestAnimationFrame(() => {
      document.getElementById("simulation-boot-title")?.focus();
    });
  }, [send]);

  const exit = useCallback(() => {
    runEpochRef.current += 1;
    for (const controller of activeRequestsRef.current) controller.abort();
    activeRequestsRef.current.clear();
    clearSimulationProgress();
    void endSimulationSession();
  }, []);

  return {
    stateName,
    context,
    sceneId,
    scene,
    stageKind,
    progressIndex: campaignProgressIndex(stateName),
    start,
    completeWave,
    advance,
    arenaFeedback,
    restart,
    exit,
  };
}
