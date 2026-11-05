"use client";
import {
  PROGRAM_INFO,
  compatibleHand,
  type Program,
} from "@/lib/simulation/network/battle";
import styles from "./Network.module.css";
export function CustomPanel({
  programs,
  selected,
  setSelected,
  confirm,
}: {
  programs: Program[];
  selected: Program[];
  setSelected(value: Program[]): void;
  confirm(): void;
}) {
  const options = [...new Set(programs)];
  return (
    <section className={styles.customPanel}>
      <p>
        Time is stopped. Pick up to three chips with the same code. ★ fits
        either code.
      </p>
      <div className={styles.customChips}>
        {options.map((program) => {
          const info = PROGRAM_INFO[program],
            index = selected.indexOf(program),
            next =
              index >= 0
                ? selected.filter((p) => p !== program)
                : [...selected, program];
          return (
            <button
              key={program}
              aria-pressed={index >= 0}
              disabled={index < 0 && !compatibleHand(next)}
              onClick={() => setSelected(next)}
            >
              <span className={styles.chipCode}>
                {info.code === "*" ? "★" : info.code}
              </span>
              <span className={styles.chipArt} aria-hidden="true">
                {info.icon}
              </span>
              <strong>{program}</strong>
              <span className={styles.chipPower}>{info.power}</span>
              <small>{info.effect}</small>
              <span className={styles.chipOrder}>
                {index >= 0 ? `0${index + 1} / selected` : "Select chip"}
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.customFooter}>
        <div>
          <strong>{selected.length}/3 loaded</strong>
          <p>{selected.join(" → ") || "Blaster only"}</p>
        </div>
        <button onClick={() => setSelected([])}>Clear</button>
        <button
          className={styles.battleStart}
          disabled={!compatibleHand(selected)}
          onClick={confirm}
        >
          Battle start →
        </button>
      </div>
      <p className={styles.combatHelp}>
        Arrows / WASD: move · Z: hold, then release to shoot · X / Space: chip ·
        C: chip select when the gauge fills.
      </p>
    </section>
  );
}
