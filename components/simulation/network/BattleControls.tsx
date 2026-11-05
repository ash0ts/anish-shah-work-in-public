"use client";
import type { ActorRefFrom } from "xstate";
import type { networkMachine } from "@/lib/simulation/network/machine";
import type { Battle } from "@/lib/simulation/network/battle";
import styles from "./Network.module.css";
export function BattleControls({
  activeBattle,
  stepMode,
  setStepMode,
  capability,
  still,
  send,
  open,
}: {
  activeBattle: Battle;
  stepMode: boolean;
  setStepMode(value: boolean): void;
  capability: boolean;
  still: boolean;
  send: ActorRefFrom<typeof networkMachine>["send"];
  open(type: "FOLDER"): void;
}) {
  return (
    <section className={styles.battleControls} aria-label="Battle controls">
      <div className={styles.battleStatus}>
        <strong>YOU {activeBattle.health}/12</strong>
        <span>GLITCH {activeBattle.integrity}</span>
        <span role="status">
          {activeBattle.outcome === "active"
            ? `${activeBattle.phase}: ${activeBattle.event}`
            : activeBattle.outcome}
        </span>
      </div>
      <label>
        <input
          type="checkbox"
          checked={stepMode || !capability || still}
          onChange={(e) => setStepMode(e.target.checked)}
          disabled={!capability || still}
        />{" "}
        Step mode
      </label>
      <div
        className={styles.board}
        role="group"
        aria-label="Six-column three-row battle board"
      >
        {Array.from({ length: 18 }, (_, index) => {
          const x = index % 6,
            y = Math.floor(index / 6),
            player = activeBattle.player.x === x && activeBattle.player.y === y,
            enemy = activeBattle.enemy.x === x && activeBattle.enemy.y === y,
            danger = activeBattle.danger.some((c) => c.x === x && c.y === y);
          return (
            <button
              key={index}
              disabled={x > 2 || activeBattle.outcome !== "active"}
              data-side={x < 3 ? "player" : "enemy"}
              data-danger={danger}
              aria-label={`Row ${y + 1}, column ${x + 1}${player ? ", you" : ""}${enemy ? ", glitch" : ""}${danger ? ", attack warning" : ""}`}
              onClick={() => {
                const dx = x - activeBattle.player.x,
                  dy = y - activeBattle.player.y;
                if (Math.abs(dx) + Math.abs(dy) === 1)
                  send({
                    type: "BATTLE",
                    action: { type: "move", dx, dy },
                  });
              }}
            >
              {player ? "◉" : enemy ? "◆" : danger ? "!" : "·"}
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button
          disabled={
            activeBattle.outcome !== "active" ||
            !activeBattle.queue.length ||
            activeBattle.tick < activeBattle.readyAt
          }
          onClick={() => send({ type: "BATTLE", action: { type: "use" } })}
        >
          Use {activeBattle.queue[0] ?? "—"}
        </button>
        <button onClick={() => open("FOLDER")}>
          Load programs · pauses battle
        </button>
        {(stepMode || still || !capability) && (
          <button
            disabled={activeBattle.outcome !== "active"}
            onClick={() => send({ type: "BATTLE", action: { type: "step" } })}
          >
            Advance one step
          </button>
        )}
        <button
          onClick={() =>
            send({ type: "ENCOUNTER", encounter: activeBattle.encounter })
          }
        >
          Retry
        </button>
        <button
          onClick={() => {
            send({ type: "BATTLE", action: { type: "skip" } });
            send({ type: "PAUSE" });
            send({ type: "CLOSE" });
          }}
        >
          Leave battle
        </button>
      </div>
      {activeBattle.outcome === "won" && (
        <p>Signal restored. Your discoveries were available all along.</p>
      )}
    </section>
  );
}
