"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ArenaProgress,
  SimulationDifficulty,
  SimulationSceneId,
} from "./types";
import { ENCOUNTERS } from "./types";
import styles from "@/app/simulation/simulation.module.css";

type Coordinate = [number, number];
type Move = "up" | "down" | "left" | "right";

const signalCoordinates: Coordinate[] = [
  [0, 0],
  [1, 3],
  [3, 4],
  [4, 1],
  [2, 4],
  [4, 3],
];

function targetFor(difficulty: SimulationDifficulty) {
  if (difficulty === "story") return 2;
  if (difficulty === "expert") return 4;
  return 3;
}

function minimumTurnsFor(difficulty: SimulationDifficulty) {
  if (difficulty === "story") return 12;
  if (difficulty === "expert") return 26;
  return 20;
}

function sameCoordinate(left: Coordinate, right: Coordinate) {
  return left[0] === right[0] && left[1] === right[1];
}

function coordinateLabel([row, column]: Coordinate) {
  return `row ${row + 1}, column ${column + 1}`;
}

export function TacticalArena({
  sceneId,
  difficulty,
  onComplete,
  onFeedback,
}: {
  sceneId: SimulationSceneId;
  difficulty: SimulationDifficulty;
  onComplete: (progress: ArenaProgress) => void;
  onFeedback?: (kind: "hit" | "evidence" | "recalibrate") => void;
}) {
  const encounter = ENCOUNTERS[sceneId];
  const target = targetFor(difficulty);
  const minimumTurns = minimumTurnsFor(difficulty);
  const [cursor, setCursor] = useState<Coordinate>([2, 2]);
  const [signals, setSignals] = useState<Coordinate[]>(
    signalCoordinates.slice(0, target + 1),
  );
  const [context, setContext] = useState(3);
  const [found, setFound] = useState(0);
  const [turn, setTurn] = useState(0);
  const [recalibrations, setRecalibrations] = useState(0);
  const [hazardRelief, setHazardRelief] = useState(0);
  const [announcement, setAnnouncement] = useState(
    "The tactical channel is ready.",
  );
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (
      completedRef.current ||
      found < target ||
      turn < minimumTurns
    ) {
      return;
    }
    completedRef.current = true;
    setAnnouncement("Encounter complete. The debrief is opening.");
    const timeout = window.setTimeout(
      () =>
        onCompleteRef.current({
          context,
          signalsFound: found,
          elapsedSeconds: turn,
          recalibrations,
        }),
      280,
    );
    return () => window.clearTimeout(timeout);
  }, [context, found, minimumTurns, recalibrations, target, turn]);

  const move = (direction: Move) => {
    if (completedRef.current) return;
    const delta: Record<Move, Coordinate> = {
      up: [-1, 0],
      down: [1, 0],
      left: [0, -1],
      right: [0, 1],
    };
    const next: Coordinate = [
      Math.max(0, Math.min(4, cursor[0] + delta[direction][0])),
      Math.max(0, Math.min(4, cursor[1] + delta[direction][1])),
    ];
    const nextTurn = turn + 1;
    const hazard = encounter.tacticalHazards
      .slice(0, Math.max(1, encounter.tacticalHazards.length - hazardRelief))
      .some(([row, column], index) =>
      sameCoordinate(
        [row, (column + nextTurn + index) % 5],
        next,
      ),
    );
    const signal = signals.find((coordinate) => sameCoordinate(coordinate, next));

    setCursor(next);
    setTurn(nextTurn);
    if (signal) {
      onFeedback?.("evidence");
      setSignals((current) =>
        current.filter((coordinate) => !sameCoordinate(coordinate, signal)),
      );
      setFound((value) => value + 1);
      setAnnouncement(`Signal recovered at ${coordinateLabel(next)}.`);
      return;
    }
    if (hazard) {
      if (context <= 1) {
        onFeedback?.("recalibrate");
        setContext(2);
        setRecalibrations((value) => value + 1);
        setHazardRelief((value) => value + 1);
        setAnnouncement(
          `A reductive label occupied ${coordinateLabel(next)}. Context recalibrated instead of ending the run.`,
        );
      } else {
        onFeedback?.("hit");
        setContext((value) => value - 1);
        setAnnouncement(
          `A reductive label occupied ${coordinateLabel(next)}. One context point was lost.`,
        );
      }
      return;
    }
    setAnnouncement(`Query cursor moved to ${coordinateLabel(next)}.`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const keyMap: Record<string, Move | undefined> = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
    };
    const direction = keyMap[event.key];
    if (!direction) return;
    event.preventDefault();
    move(direction);
  };

  const currentHazards = encounter.tacticalHazards
    .slice(0, Math.max(1, encounter.tacticalHazards.length - hazardRelief))
    .map(
      ([row, column], index): Coordinate => [row, (column + turn + index) % 5],
    );

  return (
    <section
      className={styles.tacticalArena}
      aria-labelledby={`${sceneId}-tactical-title`}
      onKeyDown={onKeyDown}
      tabIndex={0}
      data-simulation-tactical-arena
    >
      <div className={styles.arenaHeading}>
        <div>
          <p>Tactical channel · {difficulty}</p>
          <h3 id={`${sceneId}-tactical-title`}>{encounter.arenaLabel}</h3>
        </div>
        <span>Turn {Math.min(turn, minimumTurns)}/{minimumTurns}</span>
      </div>

      <div
        className={styles.tacticalGrid}
        role="img"
        aria-label={`Five by five evidence field. Query cursor at ${coordinateLabel(cursor)}. ${found} of ${target} signals recovered. ${currentHazards.length} reductive labels are active.`}
      >
        {Array.from({ length: 25 }, (_, index) => {
          const coordinate: Coordinate = [Math.floor(index / 5), index % 5];
          const hasCursor = sameCoordinate(coordinate, cursor);
          const hasSignal = signals.some((signal) =>
            sameCoordinate(signal, coordinate),
          );
          const hasHazard = currentHazards.some((hazard) =>
            sameCoordinate(hazard, coordinate),
          );
          return (
            <div
              className={styles.tacticalCell}
              data-cursor={hasCursor || undefined}
              data-signal={hasSignal || undefined}
              data-hazard={hasHazard || undefined}
              key={`${coordinate[0]}-${coordinate[1]}`}
              aria-hidden="true"
            >
              <span aria-hidden="true">
                {hasCursor ? "△" : hasSignal ? "◇" : hasHazard ? "×" : "·"}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.arenaStatus}>
        <span>Context {context}/3</span>
        <span>Signals {found}/{target}</span>
        <span>{recalibrations} recalibrations</span>
      </div>

      <p className={styles.srAnnouncement} role="status" aria-live="polite">
        {announcement}
      </p>

      <div className={styles.tacticalControls} aria-label="Tactical movement">
        {(["up", "left", "down", "right"] as const).map((direction) => (
          <button key={direction} type="button" onClick={() => move(direction)}>
            <span aria-hidden="true">
              {{ up: "↑", down: "↓", left: "←", right: "→" }[direction]}
            </span>
            <span className={styles.visuallyHidden}>Move {direction}</span>
          </button>
        ))}
      </div>
      <p className={styles.tacticalHelp}>
        Move with arrow keys, WASD, or the controls. Signals move the model
        toward evidence; labels cost context but never end the run. Recover the
        required signals and keep testing the model through {minimumTurns} turns.
      </p>
    </section>
  );
}
