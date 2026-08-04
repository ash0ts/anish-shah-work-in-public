"use client";

import Link from "next/link";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMachine } from "@xstate/react";
import { assign, setup } from "xstate";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import {
  endSimulationSession,
  requestSimulationTurn,
  startSimulationSession,
} from "./simulation-client";
import {
  clearSimulationProgress,
  writeSimulationProgress,
} from "./simulation-progress";
import { TacticalArena } from "./TacticalArena";
import type {
  ArenaProgress,
  CuriosityVector,
  ModelTurnOutput,
  SimulationDifficulty,
  SimulationDossier,
  SimulationMode,
  SimulationSceneId,
  SimulationTurnResponse,
  VisitorSignal,
} from "./types";
import styles from "@/app/simulation/simulation.module.css";

const LazyActionArena = lazy(() => import("./ActionArena"));

type CampaignStateName =
  | "boot"
  | "act1Wave"
  | "act1Debrief"
  | "act2Wave"
  | "act2Debrief"
  | "act3Wave"
  | "act3Debrief"
  | "bossWave"
  | "bossDebrief"
  | "ending";

type CampaignContext = {
  dossier: SimulationDossier;
  mode: SimulationMode;
  difficulty: SimulationDifficulty;
  curiosity: CuriosityVector;
  revision: number;
  pendingTurns: number;
  lastOpponent: ModelTurnOutput | null;
  responseSource: "generated" | "fixture" | "authored_fallback" | null;
  revealedFactIds: string[];
  visitorSignals: VisitorSignal[];
  selectedDoorway: string | null;
  scores: {
    signalFound: number;
    claimsGrounded: number;
    curiosityFollowed: number;
  };
  recalibrations: number;
};

type CampaignEvent =
  | {
      type: "START";
      mode: SimulationMode;
      difficulty: SimulationDifficulty;
      curiosity: CuriosityVector;
    }
  | { type: "SESSION_READY"; revision: number }
  | { type: "WAVE_COMPLETE"; progress: ArenaProgress }
  | { type: "ADVANCE"; sceneId: SimulationSceneId; actionId: string }
  | { type: "TURN_REQUESTED" }
  | { type: "TURN_RESOLVED"; response: SimulationTurnResponse }
  | { type: "RESET" };

function initialContext(dossier: SimulationDossier): CampaignContext {
  return {
    dossier,
    mode: "tactical",
    difficulty: "standard",
    curiosity: "systems",
    revision: 0,
    pendingTurns: 0,
    lastOpponent: null,
    responseSource: null,
    revealedFactIds: [],
    visitorSignals: [],
    selectedDoorway: null,
    scores: {
      signalFound: 0,
      claimsGrounded: 0,
      curiosityFollowed: 0,
    },
    recalibrations: 0,
  };
}

const campaignMachine = setup({
  types: {
    context: {} as CampaignContext,
    events: {} as CampaignEvent,
    input: {} as { dossier: SimulationDossier },
  },
  actions: {
    recordWave: assign({
      scores: ({ context, event }) =>
        event.type === "WAVE_COMPLETE"
          ? {
              ...context.scores,
              signalFound:
                context.scores.signalFound + event.progress.signalsFound,
            }
          : context.scores,
      recalibrations: ({ context, event }) =>
        event.type === "WAVE_COMPLETE"
          ? context.recalibrations + event.progress.recalibrations
          : context.recalibrations,
    }),
    recordChoice: assign({
      selectedDoorway: ({ context, event }) =>
        event.type === "ADVANCE" && event.sceneId === "act-3"
          ? event.actionId
          : context.selectedDoorway,
      scores: ({ context }) => ({
        ...context.scores,
        curiosityFollowed: context.scores.curiosityFollowed + 1,
      }),
    }),
  },
}).createMachine({
  id: "meet-me-4n1sh",
  initial: "boot",
  context: ({ input }) => initialContext(input.dossier),
  on: {
    SESSION_READY: {
      actions: assign({
        revision: ({ context, event }) =>
          Math.max(context.revision, event.revision),
      }),
    },
    TURN_REQUESTED: {
      actions: assign({
        pendingTurns: ({ context }) => context.pendingTurns + 1,
      }),
    },
    TURN_RESOLVED: {
      actions: assign({
        revision: ({ event }) => event.response.revision,
        pendingTurns: ({ context }) => Math.max(0, context.pendingTurns - 1),
        lastOpponent: ({ event }) => event.response.opponent,
        responseSource: ({ event }) => event.response.source,
        revealedFactIds: ({ context, event }) => [
          ...new Set([
            ...context.revealedFactIds,
            ...event.response.factCards.map((fact) => fact.id),
          ]),
        ],
        visitorSignals: ({ context, event }) => [
          ...new Set([
            ...context.visitorSignals,
            ...event.response.opponent.visitorSignals,
          ]),
        ],
        scores: ({ context, event }) => ({
          ...context.scores,
          claimsGrounded:
            context.scores.claimsGrounded + event.response.factCards.length,
          curiosityFollowed:
            context.scores.curiosityFollowed +
            Number(event.response.opponent.visitorSignals.length > 0),
        }),
      }),
    },
    RESET: {
      target: ".boot",
      actions: assign(({ context }) => initialContext(context.dossier)),
    },
  },
  states: {
    boot: {
      on: {
        START: {
          target: "act1Wave",
          actions: assign({
            mode: ({ event }) => event.mode,
            difficulty: ({ event }) => event.difficulty,
            curiosity: ({ event }) => event.curiosity,
          }),
        },
      },
    },
    act1Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act1Debrief",
          actions: "recordWave",
        },
      },
    },
    act1Debrief: {
      on: { ADVANCE: { target: "act2Wave", actions: "recordChoice" } },
    },
    act2Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act2Debrief",
          actions: "recordWave",
        },
      },
    },
    act2Debrief: {
      on: { ADVANCE: { target: "act3Wave", actions: "recordChoice" } },
    },
    act3Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act3Debrief",
          actions: "recordWave",
        },
      },
    },
    act3Debrief: {
      on: { ADVANCE: { target: "bossWave", actions: "recordChoice" } },
    },
    bossWave: {
      on: {
        WAVE_COMPLETE: {
          target: "bossDebrief",
          actions: "recordWave",
        },
      },
    },
    bossDebrief: {
      on: { ADVANCE: { target: "ending", actions: "recordChoice" } },
    },
    ending: {},
  },
});

const sceneByState: Partial<Record<CampaignStateName, SimulationSceneId>> = {
  act1Wave: "act-1",
  act1Debrief: "act-1",
  act2Wave: "act-2",
  act2Debrief: "act-2",
  act3Wave: "act-3",
  act3Debrief: "act-3",
  bossWave: "boss",
  bossDebrief: "boss",
};

const actionLabels: Record<string, { label: string; hint: string }> = {
  "trace-the-system": {
    label: "Trace the system",
    hint: "Follow the interface to the artifacts and feedback loops it connects.",
  },
  "follow-the-people": {
    label: "Follow the people",
    hint: "Look for teaching, collaborators, and public communities.",
  },
  "inspect-the-artifact": {
    label: "Inspect the artifact",
    hint: "Start with what a public recording, repository, or article can support.",
  },
  probe: {
    label: "Probe",
    hint: "Ask what evidence could prove this first answer wrong.",
  },
  trace: {
    label: "Trace",
    hint: "Follow the claim to its public source.",
  },
  qualify: {
    label: "Qualify",
    hint: "Keep scope, period, and attribution attached.",
  },
  reframe: {
    label: "Reframe",
    hint: "Replace the confident label with a better question.",
  },
  watch: { label: "Watch", hint: "Open the anime broadcast doorway." },
  read: { label: "Read", hint: "Open the borrowed shelf doorway." },
  listen: { label: "Listen", hint: "Open the pocket-player doorway." },
  collect: { label: "Collect", hint: "Open the record-crate doorway." },
  play: { label: "Play", hint: "Open the desktop-library doorway." },
  move: { label: "Move", hint: "Open the cardio-television doorway." },
  "ground-the-claim": {
    label: "Ground the claim",
    hint: "Keep the artifact attached to the conclusion.",
  },
  "keep-the-qualifier": {
    label: "Keep the qualifier",
    hint: "Precision survives when its boundaries remain visible.",
  },
  "connect-the-facets": {
    label: "Connect the facets",
    hint: "Refuse the single label. Preserve the plural body of work.",
  },
};

const curiosityCopy: Record<CuriosityVector, string> = {
  systems: "How do the interfaces, evaluations, and feedback loops connect?",
  research: "Which claims survive contact with inspectable evidence?",
  teaching: "How does technical work travel through explanation and practice?",
  surprise: "Which public artifact most resists the obvious first label?",
};

function recommendedMode(): SimulationMode {
  if (typeof window === "undefined") return "tactical";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const forced = window.matchMedia("(forced-colors: active)").matches;
  const zoomed = (window.visualViewport?.scale ?? 1) > 1.25;
  const saveData = Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData,
  );
  const canvasAvailable = Boolean(
    document.createElement("canvas").getContext("2d"),
  );
  return reduced || forced || zoomed || saveData || !canvasAvailable || window.innerWidth < 760
    ? "tactical"
    : "action";
}

function graphemeCount(value: string) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
      .length;
  }
  return Array.from(value).length;
}

function BootScreen({
  dossier,
  onStart,
}: {
  dossier: SimulationDossier;
  onStart: (
    mode: SimulationMode,
    difficulty: SimulationDifficulty,
    curiosity: CuriosityVector,
  ) => void;
}) {
  const [mode, setMode] = useState<SimulationMode>("tactical");
  const [difficulty, setDifficulty] =
    useState<SimulationDifficulty>("standard");
  const [curiosity, setCuriosity] = useState<CuriosityVector>("systems");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMode(recommendedMode()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section className={styles.boot} aria-labelledby="simulation-boot-title">
      <div className={styles.robotPortrait} aria-hidden="true">
        <span className={styles.robotAntenna} />
        <span className={styles.robotHead}>
          <i />
          <i />
          <b>?</b>
        </span>
        <span className={styles.robotBody}>PUBLIC MODEL</span>
      </div>

      <div className={styles.bootCopy}>
        <p>Meet Me mode · Campaign {dossier.campaignVersion}</p>
        <h1 id="simulation-boot-title" tabIndex={-1}>
          You are not here to beat <span>4N1SH.</span>
        </h1>
        <p>
          You are here to beat its first, overconfident answer. Retrieve the
          public record, keep its qualifiers intact, and leave with a better
          question for the real person.
        </p>
      </div>

      <form
        className={styles.bootConsole}
        onSubmit={(event) => {
          event.preventDefault();
          onStart(mode, difficulty, curiosity);
        }}
      >
        <fieldset>
          <legend>Choose a channel</legend>
          <div className={styles.choicePair}>
            {(["action", "tactical"] as const).map((value) => (
              <label key={value} data-selected={mode === value || undefined}>
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <strong>{value === "action" ? "Action" : "Tactical"}</strong>
                <span>
                  {value === "action"
                    ? "Real-time signal retrieval."
                    : "Turn-based semantic grid."}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Set the resistance</legend>
          <div className={styles.segmentedChoices}>
            {(["story", "standard", "expert"] as const).map((value) => (
              <label key={value} data-selected={difficulty === value || undefined}>
                <input
                  type="radio"
                  name="difficulty"
                  value={value}
                  checked={difficulty === value}
                  onChange={() => setDifficulty(value)}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Choose a curiosity vector</legend>
          <div className={styles.curiosityChoices}>
            {(Object.keys(curiosityCopy) as CuriosityVector[]).map((value) => (
              <label
                key={value}
                data-selected={curiosity === value || undefined}
              >
                <input
                  type="radio"
                  name="curiosity"
                  value={value}
                  checked={curiosity === value}
                  onChange={() => setCuriosity(value)}
                />
                <strong>{value}</strong>
                <span>{curiosityCopy[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button className={styles.bootButton} type="submit">
          Boot the public model
          <span aria-hidden="true">↳</span>
        </button>
        <p>
          Action and Tactical reveal the same facts and ending. You can finish
          the campaign even if the generated dialogue is unavailable.
        </p>
      </form>
    </section>
  );
}

function DebriefPanel({
  dossier,
  sceneId,
  pending,
  onAdvance,
}: {
  dossier: SimulationDossier;
  sceneId: SimulationSceneId;
  pending: boolean;
  onAdvance: (actionId: string, freeText?: string) => void;
}) {
  const scene = dossier.scenes.find((candidate) => candidate.id === sceneId)!;
  const [actionId, setActionId] = useState(scene.allowedActionIds[0]);
  const [freeText, setFreeText] = useState("");
  const count = graphemeCount(freeText);
  const valid = count <= 280;

  return (
    <section className={styles.debrief} aria-labelledby={`${sceneId}-debrief-title`}>
      <header>
        <p>Channel recovered</p>
        <h2 id={`${sceneId}-debrief-title`}>{scene.title}</h2>
        <p>{scene.encounter}</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || !actionId) return;
          onAdvance(actionId, freeText.trim() || undefined);
          setFreeText("");
        }}
      >
        <fieldset>
          <legend>Choose your next move</legend>
          <div className={styles.actionChoices}>
            {scene.allowedActionIds.map((id) => (
              <label key={id} data-selected={actionId === id || undefined}>
                <input
                  type="radio"
                  name={`action-${sceneId}`}
                  value={id}
                  checked={actionId === id}
                  onChange={() => setActionId(id)}
                />
                <strong>{actionLabels[id]?.label ?? id}</strong>
                <span>{actionLabels[id]?.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {scene.allowsFreeText ? (
          <div className={styles.freeTextField}>
            <label htmlFor={`${sceneId}-free-text`}>
              Optional message to 4N1SH
              <span>Do not enter private, confidential, or identifying information.</span>
            </label>
            <textarea
              id={`${sceneId}-free-text`}
              value={freeText}
              rows={3}
              onChange={(event) => setFreeText(event.target.value.slice(0, 2_000))}
              aria-describedby={`${sceneId}-count ${sceneId}-privacy`}
              aria-errormessage={!valid ? `${sceneId}-error` : undefined}
              aria-invalid={!valid || undefined}
            />
            <div>
              <small id={`${sceneId}-privacy`}>
                The site does not retain this text. Provider processing may still
                apply when live dialogue is enabled.
              </small>
              <small
                id={`${sceneId}-count`}
                data-invalid={!valid || undefined}
              >
                {count}/280
              </small>
            </div>
            {!valid ? (
              <p id={`${sceneId}-error`} role="alert">
                Shorten this message to 280 grapheme characters or choose an
                authored response without sending text.
              </p>
            ) : null}
          </div>
        ) : null}

        <button className={styles.transmitButton} type="submit" disabled={!valid}>
          {sceneId === "boss" ? "Break the approximation" : "Transmit and continue"}
          <span aria-hidden="true">→</span>
        </button>
        {pending ? (
          <p className={styles.pendingTurn} role="status">
            A previous generated response is still resolving. Gameplay will not
            wait for it.
          </p>
        ) : null}
      </form>
    </section>
  );
}

function OpponentPanel({
  context,
}: {
  context: CampaignContext;
}) {
  const line =
    context.lastOpponent?.opponentLine ??
    "INITIAL CLAIM: One public label should be enough to explain a person.";
  const revealed = context.dossier.facts.filter((fact) =>
    context.revealedFactIds.includes(fact.id),
  );

  return (
    <aside className={styles.opponentPanel} aria-labelledby="opponent-panel-title">
      <div className={styles.opponentFace} aria-hidden="true">
        <span>4</span>
        <span>N</span>
        <span>1</span>
        <span>SH</span>
      </div>
      <div className={styles.opponentCopy}>
        <p id="opponent-panel-title">4N1SH // PUBLIC MODEL</p>
        <blockquote aria-atomic="true" aria-live="polite">
          {line}
        </blockquote>
        <p className={styles.responseSource}>
          {context.pendingTurns > 0
            ? "Generating off the critical path…"
            : context.responseSource === "generated"
              ? "Generated reaction · facts supplied by server"
              : context.responseSource === "fixture"
                ? "Deterministic preview reaction · public facts preserved"
                : context.responseSource === "authored_fallback"
                ? "Authored fallback · campaign remains complete"
                : "Public-model boot claim"}
        </p>
      </div>
      {revealed.length ? (
        <ol className={styles.revealedFacts} aria-label="Recovered facts">
          {revealed.slice(-3).map((fact) => (
            <li key={fact.id}>
              {fact.href ? <Link href={fact.href}>{fact.title}</Link> : fact.title}
              <span>{fact.allowedStatement}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}

function Ending({
  context,
  onRestart,
  onExit,
}: {
  context: CampaignContext;
  onRestart: () => void;
  onExit: () => void;
}) {
  const recovered = context.dossier.facts.filter((fact) =>
    context.revealedFactIds.includes(fact.id),
  );
  const observations = (recovered.length ? recovered : context.dossier.facts).slice(
    0,
    3,
  );
  const workLinks = (recovered.length > 1 ? recovered : context.dossier.facts).slice(
    0,
    2,
  );
  const doorway =
    context.dossier.providerDoorways.find(
      (candidate) => candidate.label.toLowerCase() === context.selectedDoorway,
    ) ?? context.dossier.providerDoorways[0];

  return (
    <section className={styles.ending} aria-labelledby="conversation-key-title">
      <header>
        <p>Model status · approximation interrupted</p>
        <h2 id="conversation-key-title">Conversation Key</h2>
        <p>
          You did not finish a personality test. You assembled a grounded way to
          begin a real conversation.
        </p>
      </header>

      <div className={styles.keyGrid}>
        <section>
          <h3>Three observations</h3>
          <ol>
            {observations.map((fact) => (
              <li key={fact.id}>{fact.allowedStatement}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3>Two artifacts</h3>
          <ul>
            {workLinks.map((fact) => (
              <li key={fact.id}>
                <Link href={fact.href ?? "/work"}>{fact.title}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>One public doorway</h3>
          <p>
            <Link href={doorway?.route ?? "/play"}>
              {doorway?.label ?? "Explore Play"}
            </Link>
          </p>
        </section>
        <section>
          <h3>A better question</h3>
          <p>{curiosityCopy[context.curiosity]}</p>
        </section>
      </div>

      <dl className={styles.finalScore}>
        <div>
          <dt>Signal found</dt>
          <dd>{context.scores.signalFound}</dd>
        </div>
        <div>
          <dt>Claims grounded</dt>
          <dd>{context.scores.claimsGrounded}</dd>
        </div>
        <div>
          <dt>Curiosity followed</dt>
          <dd>{context.scores.curiosityFollowed}</dd>
        </div>
      </dl>

      <div className={styles.endingActions}>
        <a href="https://www.linkedin.com/in/anish-shah">
          Ask the real Anish on LinkedIn
          <span aria-hidden="true">↗</span>
        </a>
        <button type="button" onClick={onRestart}>
          Recalibrate and play again
        </button>
        <Link href="/play" onClick={onExit}>Return to the room</Link>
      </div>
    </section>
  );
}

export function SimulationCampaign({ dossier }: { dossier: SimulationDossier }) {
  const audio = useExperienceAudio();
  const [snapshot, send] = useMachine(campaignMachine, { input: { dossier } });
  const stateName = String(snapshot.value) as CampaignStateName;
  const context = snapshot.context;
  const revisionRef = useRef(0);
  const turnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runEpochRef = useRef(0);
  const activeRequestsRef = useRef(new Set<AbortController>());
  const sceneId = sceneByState[stateName] ?? null;
  const scene = sceneId
    ? dossier.scenes.find((candidate) => candidate.id === sceneId)
    : null;
  const isWave = stateName.endsWith("Wave");
  const isDebrief = stateName.endsWith("Debrief");

  useEffect(() => {
    if (!audio.enabled) return;
    if (stateName === "boot") audio.playCue("simulation-boot");
    else if (stateName === "act1Wave") audio.playCue("simulation-act-1");
    else if (stateName === "act2Wave") audio.playCue("simulation-act-2");
    else if (stateName === "act3Wave") audio.playCue("simulation-act-3");
    else if (stateName === "bossWave") audio.playCue("simulation-boss");
    else if (stateName === "ending") audio.playCue("simulation-ending");
  }, [audio, stateName]);

  useEffect(() => {
    revisionRef.current = context.revision;
  }, [context.revision]);

  useEffect(() => {
    if (stateName === "boot") {
      clearSimulationProgress();
      return;
    }

    // This crash-recovery breadcrumb deliberately contains only bounded game
    // enums, public IDs, and aggregate counters. Generated dialogue and the two
    // optional visitor messages are never placed in browser persistence.
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
    (kind: "hit" | "evidence" | "near-miss" | "recalibrate") => {
      if (kind === "hit") audio.playCue("simulation-hit");
      else if (kind === "evidence") audio.playCue("simulation-evidence");
      else if (kind === "near-miss") audio.playCue("simulation-near-miss");
      else audio.playCue("simulation-recalibrate");
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

  const progressLabel = useMemo(() => {
    const stateOrder: CampaignStateName[] = [
      "boot",
      "act1Wave",
      "act1Debrief",
      "act2Wave",
      "act2Debrief",
      "act3Wave",
      "act3Debrief",
      "bossWave",
      "bossDebrief",
      "ending",
    ];
    return Math.max(0, stateOrder.indexOf(stateName));
  }, [stateName]);

  return (
    <div
      className={styles.campaign}
      data-simulation-interactive
      data-simulation-state={stateName}
    >
      <p className={styles.srAnnouncement} role="status" aria-live="polite" aria-atomic="true">
        {stateName === "boot"
          ? "Public model standby."
          : stateName === "ending"
            ? "Conversation Key assembled."
            : `${scene?.title ?? "Campaign"}: ${isWave ? "encounter" : "debrief"} ready.`}
      </p>
      <header className={styles.campaignHeader}>
        <Link href="/play" prefetch={false} onClick={exit}>
          <span aria-hidden="true">←</span> Room
        </Link>
        <div>
          <p>4N1SH // PUBLIC MODEL</p>
          <span>{dossier.persona.disclosure}</span>
        </div>
        <p>
          {stateName === "boot" ? "Standby" : `Sequence ${progressLabel}/9`}
        </p>
      </header>

      {stateName === "boot" ? (
        <BootScreen dossier={dossier} onStart={start} />
      ) : stateName === "ending" ? (
        <Ending context={context} onRestart={restart} onExit={exit} />
      ) : (
        <div className={styles.gameLayout}>
          <aside className={styles.signalLedger} aria-label="Campaign status">
            <p>{scene?.title}</p>
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
            <p>{curiosityCopy[context.curiosity]}</p>
          </aside>

          <div
            aria-label={`${scene?.title ?? "Campaign"} ${isWave ? "encounter" : "debrief"}`}
            className={styles.encounterStage}
            data-simulation-stage
            role="region"
            tabIndex={-1}
          >
            {isWave && sceneId ? (
              context.mode === "action" ? (
                <Suspense
                  fallback={
                    <div className={styles.loadingArena} role="status">
                      <span aria-hidden="true">◇</span>
                      Loading the action channel…
                    </div>
                  }
                >
                  <LazyActionArena
                    key={`${sceneId}-${context.difficulty}`}
                    sceneId={sceneId}
                    difficulty={context.difficulty}
                    onComplete={completeWave}
                    onFeedback={arenaFeedback}
                  />
                </Suspense>
              ) : (
                <TacticalArena
                  key={`${sceneId}-${context.difficulty}`}
                  sceneId={sceneId}
                  difficulty={context.difficulty}
                  onComplete={completeWave}
                  onFeedback={arenaFeedback}
                />
              )
            ) : null}
            {isDebrief && sceneId ? (
              <DebriefPanel
                dossier={dossier}
                sceneId={sceneId}
                pending={context.pendingTurns > 0}
                onAdvance={advance}
              />
            ) : null}
          </div>

          <OpponentPanel context={context} />
        </div>
      )}
    </div>
  );
}
