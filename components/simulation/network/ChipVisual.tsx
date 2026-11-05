import type { Program } from "@/lib/simulation/network/battle";
import type { Discovery } from "@/lib/simulation/network/catalog-contract";
import styles from "./Network.module.css";

/** Original circuit artwork, not provider cover art or a source-derived score. */
export function ChipVisual({
  program,
  discovery,
}: {
  program: Program;
  discovery?: Discovery;
}) {
  const symbol = {
    Pulse: "M28 52h16l8-24 12 48 8-24h28",
    Guard: "M40 26h48v32L64 82 40 58Z",
    Dash: "m32 44 32-20v20h32L64 80V60H32",
    Sweep: "M30 70q34-64 68 0M40 70q24-44 48 0",
    Snare: "M32 28h64v48H32ZM32 28l64 48M96 28 32 76",
    Repair: "M56 28h16v16h16v16H72v16H56V60H40V44h16Z",
  }[program];
  return (
    <span className={styles.discoveryArt} data-program={program}>
      <svg viewBox="0 0 128 104" aria-hidden="true">
        <path d="M8 8h94l18 18v70H8Z" fill="currentColor" opacity=".12" />
        <path
          d="M8 24h18v56h24M120 80h-18V24H78M18 16h16m60 72h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d={symbol}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="84" r="3" fill="currentColor" />
        <circle cx="110" cy="20" r="3" fill="currentColor" />
      </svg>
      <span>
        {discovery?.domain === "work"
          ? "WORK ARCHIVE"
          : (discovery?.domain?.toUpperCase() ?? "PROGRAM")}
      </span>
    </span>
  );
}
