"use client";
import { useEffect, useRef } from "react";
import type { ActorRefFrom } from "xstate";
import type { networkMachine } from "@/lib/simulation/network/machine";
import {
  CHARGE_TICKS,
  CUSTOM_TICKS,
  MAX_HEALTH,
  PROGRAM_INFO,
  type Battle,
} from "@/lib/simulation/network/battle";
import styles from "./Network.module.css";
export function BattleControls({
  activeBattle: b,
  stepMode,
  setStepMode,
  capability,
  still,
  send,
  open,
  paused,
}: {
  activeBattle: Battle;
  stepMode: boolean;
  setStepMode(value: boolean): void;
  capability: boolean;
  still: boolean;
  send: ActorRefFrom<typeof networkMachine>["send"];
  open(type: "CUSTOM" | "CHAT"): void;
  paused: boolean;
}) {
  const held = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (held.current) clearInterval(held.current);
    held.current = null;
  };
  useEffect(() => {
    if (paused) stop();
    return stop;
  }, [paused]);
  const staticBoard = stepMode || !capability || still,
    active = b.outcome === "active" && !paused;
  const move = (dx: number, dy: number) =>
    send({ type: "BATTLE", action: { type: "move", dx, dy } });
  return (
    <section
      className={styles.battleControls}
      data-static={staticBoard}
      aria-label="Battle controls"
      data-battle-tick={b.tick}
    >
      <div className={styles.battleHud}>
        <div className={styles.hp}>
          <small>4N1SH / HP</small>
          <strong>
            {String(b.health).padStart(3, "0")}
            <span>/{MAX_HEALTH}</span>
          </strong>
          <meter
            min={0}
            max={MAX_HEALTH}
            value={b.health}
            aria-label="Health"
          />
        </div>
        <div className={styles.customGauge}>
          <div>
            <span>CHIP GAUGE</span>
            <strong>
              {b.custom >= CUSTOM_TICKS
                ? "READY / C"
                : `${Math.floor((b.custom / CUSTOM_TICKS) * 100)}%`}
            </strong>
          </div>
          <progress
            max={CUSTOM_TICKS}
            value={b.custom}
            aria-label="Chip gauge"
          />
        </div>
        <div className={styles.enemyCount}>
          <small>HOSTILES</small>
          <strong>{b.enemies.filter((e) => e.health > 0).length}</strong>
        </div>
      </div>
      {staticBoard && (
        <div
          className={styles.board}
          role="group"
          aria-label="Six-column three-row battle board"
        >
          {Array.from({ length: 18 }, (_, index) => {
            const x = index % 6,
              y = Math.floor(index / 6),
              player = b.player.x === x && b.player.y === y,
              enemy = b.enemies.find(
                (e) => e.health > 0 && e.x === x && e.y === y,
              ),
              danger = b.danger.some((c) => c.x === x && c.y === y);
            return (
              <button
                key={index}
                disabled={x > 2 || !active}
                data-side={x < 3 ? "player" : "enemy"}
                data-danger={danger}
                aria-label={`Row ${y + 1}, column ${x + 1}${player ? ", you" : ""}${enemy ? `, ${enemy.kind}, ${enemy.health} health` : ""}${danger ? ", attack warning" : ""}`}
                onClick={() => move(x - b.player.x, y - b.player.y)}
              >
                {player ? "◉" : enemy ? "◆" : danger ? "!" : "·"}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.battleBottom}>
        <div className={styles.loadedChips} aria-label="Loaded chips">
          {b.queue.length ? (
            b.queue.map((p, i) => (
              <span key={`${i}:${p}`} data-next={i === 0}>
                <i aria-hidden="true">{PROGRAM_INFO[p].icon}</i>
                <strong>{p}</strong>
                <small>{PROGRAM_INFO[p].power}</small>
              </span>
            ))
          ) : (
            <span>
              <strong>Blaster ready</strong>
              <small>Refill chips when the gauge is full</small>
            </span>
          )}
        </div>
        <div className={styles.battleInputs}>
          <div className={styles.battleDpad} aria-label="Battle movement">
            {[
              [0, -1, "↑", "Up"],
              [-1, 0, "←", "Left"],
              [0, 1, "↓", "Down"],
              [1, 0, "→", "Right"],
            ].map(([dx, dy, icon, label]) => (
              <button
                key={String(label)}
                aria-label={String(label)}
                disabled={!active}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  stop();
                  move(Number(dx), Number(dy));
                  if (!staticBoard)
                    held.current = setInterval(
                      () => move(Number(dx), Number(dy)),
                      100,
                    );
                }}
                onPointerUp={stop}
                onPointerCancel={stop}
                onLostPointerCapture={stop}
                onClick={(e) => {
                  if (e.detail === 0) move(Number(dx), Number(dy));
                }}
              >
                {icon}
              </button>
            ))}
          </div>
          <button
            className={styles.blasterButton}
            disabled={!active}
            aria-label="Blaster"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              send({ type: "BATTLE", action: { type: "charge", held: true } });
            }}
            onPointerUp={() =>
              send({ type: "BATTLE", action: { type: "charge", held: false } })
            }
            onPointerCancel={() =>
              send({ type: "BATTLE", action: { type: "cancel-charge" } })
            }
            onLostPointerCapture={() =>
              send({ type: "BATTLE", action: { type: "cancel-charge" } })
            }
            onClick={(e) => {
              if (e.detail === 0)
                send({ type: "BATTLE", action: { type: "shoot" } });
            }}
          >
            <small>Z / HOLD</small>
            <strong>{b.charge >= CHARGE_TICKS ? "CHARGED" : "BLASTER"}</strong>
            <progress max={CHARGE_TICKS} value={b.charge} aria-label="Charge" />
          </button>
          <button
            className={styles.useChipButton}
            disabled={!active || !b.queue.length || b.tick < b.readyAt}
            onClick={() => send({ type: "BATTLE", action: { type: "use" } })}
            aria-label={`Use ${b.queue[0] ?? "chip"}`}
          >
            <small>X / SPACE</small>
            <strong>{b.queue[0] ?? "NO CHIP"}</strong>
          </button>
          <button
            className={styles.customButton}
            disabled={!active || b.custom < CUSTOM_TICKS}
            onClick={() => open("CUSTOM")}
          >
            <small>C / PAUSE & PICK</small>
            <strong>CHIP SELECT</strong>
          </button>
        </div>
      </div>
      <div className={styles.battleOptions}>
        <label>
          <input
            type="checkbox"
            checked={staticBoard}
            onChange={(e) => setStepMode(e.target.checked)}
            disabled={!capability || still}
          />
          Step mode
        </label>
        {staticBoard && (
          <button
            disabled={!active}
            aria-pressed={b.charging}
            onClick={() =>
              send({
                type: "BATTLE",
                action: { type: "charge", held: !b.charging },
              })
            }
          >
            {b.charging ? "Release shot" : "Start charging"}
          </button>
        )}
        {staticBoard && (
          <button
            disabled={!active}
            onClick={() =>
              send({ type: "BATTLE", action: { type: "step", ticks: 5 } })
            }
          >
            Advance ¼ second
          </button>
        )}
        {b.outcome === "active" && (
          <>
            <button disabled={paused} onClick={() => send({ type: "PAUSE" })}>
              Pause battle
            </button>
            <button
              onClick={() =>
                send({ type: "ENCOUNTER", encounter: b.encounter })
              }
            >
              Retry
            </button>
          </>
        )}
        <button onClick={() => send({ type: "EXIT_BATTLE" })}>
          Leave battle
        </button>
        <button onClick={() => open("CHAT")}>Ask companion</button>
        <span className={styles.srOnly} role="status">
          {b.outcome !== "active"
            ? b.event
            : b.custom >= CUSTOM_TICKS
              ? "Chip selection ready"
              : "Battle active"}
        </span>
      </div>
      {b.outcome !== "active" && (
        <div className={styles.battleOutcome}>
          <small>
            {b.outcome === "won"
              ? "CONNECTION STABLE"
              : "CONNECTION INTERRUPTED"}
          </small>
          <h2>
            {b.outcome === "won"
              ? "Network restored."
              : "Try a different hand."}
          </h2>
          <p>
            {b.outcome === "won"
              ? "Discoveries stay yours. Take another route."
              : "Dodge the marked lane. Charge between attacks."}
          </p>
          <button
            onClick={() => send({ type: "ENCOUNTER", encounter: b.encounter })}
          >
            Retry
          </button>
          <button onClick={() => send({ type: "EXIT_BATTLE" })}>
            Return to network
          </button>
        </div>
      )}
    </section>
  );
}
