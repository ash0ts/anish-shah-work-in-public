import { useEffect, useState } from "react";
import { SITE_COPY } from "@/lib/copy";
import styles from "@/app/simulation/simulation.module.css";
import type {
  CuriosityVector,
  SimulationDifficulty,
  SimulationDossier,
  SimulationMode,
} from "../types";
import { CURIOSITY_COPY } from "./campaign-copy";
import {
  browserSimulationCapabilities,
  recommendedSimulationMode,
} from "./campaign-capabilities";

export type BootSequenceProps = {
  dossier: SimulationDossier;
  onStart: (
    mode: SimulationMode,
    difficulty: SimulationDifficulty,
    curiosity: CuriosityVector,
  ) => void;
};

export function BootSequence({ dossier, onStart }: BootSequenceProps) {
  const [mode, setMode] = useState<SimulationMode>("tactical");
  const [difficulty, setDifficulty] =
    useState<SimulationDifficulty>("standard");
  const [curiosity, setCuriosity] = useState<CuriosityVector>("systems");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setMode(recommendedSimulationMode(browserSimulationCapabilities())),
    );
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
        <p>
          {SITE_COPY.simulation["boot-eyebrow"]} · Campaign {dossier.campaignVersion}
        </p>
        <h1 id="simulation-boot-title" tabIndex={-1}>
          {SITE_COPY.simulation["boot-title"]}
        </h1>
        <p>{SITE_COPY.simulation["boot-summary"]}</p>
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
              <label
                key={value}
                data-selected={difficulty === value || undefined}
              >
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
            {(Object.keys(CURIOSITY_COPY) as CuriosityVector[]).map((value) => (
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
                <span>{CURIOSITY_COPY[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button className={styles.bootButton} type="submit">
          {SITE_COPY.simulation["start-cta"]}
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
