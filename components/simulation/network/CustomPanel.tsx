"use client";
import {
  PROGRAM_INFO,
  compatibleHand,
  type Program,
} from "@/lib/simulation/network/battle";
import styles from "./Network.module.css";
import { ChipVisual } from "./ChipVisual";
import type { Discovery } from "@/lib/simulation/network/catalog-contract";
export function CustomPanel({
  programs,
  selected,
  setSelected,
  confirm,
  equipped,
  catalog,
}: {
  programs: Program[];
  selected: Program[];
  setSelected(value: Program[]): void;
  confirm(): void;
  equipped: Array<{ program: Program; discoveryId: string | null }>;
  catalog: Discovery[];
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
          const discovery = catalog.find(
            (item) =>
              item.id ===
              equipped.find((slot) => slot.program === program)?.discoveryId,
          );
          const info = PROGRAM_INFO[program],
            index = selected.indexOf(program),
            next =
              index >= 0
                ? selected.filter((p) => p !== program)
                : [...selected, program];
          return (
            <button
              key={program}
              aria-label={`${info.code === "*" ? "★" : info.code} ${program}${discovery ? ` · ${discovery.title}` : ""} · ${info.effect}`}
              aria-pressed={index >= 0}
              disabled={index < 0 && !compatibleHand(next)}
              onClick={() => setSelected(next)}
            >
              <span className={styles.chipCode}>
                {info.code === "*" ? "★" : info.code}
              </span>
              <ChipVisual program={program} discovery={discovery} />
              <strong>{discovery?.title ?? program}</strong>
              <span>Game program · {program}</span>
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
