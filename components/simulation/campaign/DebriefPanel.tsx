import { useState } from "react";
import styles from "@/app/simulation/simulation.module.css";
import type { SimulationDossier, SimulationSceneId } from "../types";
import { ACTION_COPY } from "./campaign-copy";

export type DebriefPanelProps = {
  dossier: SimulationDossier;
  sceneId: SimulationSceneId;
  pending: boolean;
  onAdvance: (actionId: string, freeText?: string) => void;
};

function graphemeCount(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value),
    ].length;
  }
  return Array.from(value).length;
}

export function DebriefPanel({
  dossier,
  sceneId,
  pending,
  onAdvance,
}: DebriefPanelProps) {
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
                <strong>{ACTION_COPY[id]?.label ?? id}</strong>
                <span>{ACTION_COPY[id]?.hint}</span>
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
              <small id={`${sceneId}-count`} data-invalid={!valid || undefined}>
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
