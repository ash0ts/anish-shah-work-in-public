import Link from "next/link";
import styles from "@/app/simulation/simulation.module.css";
import type { CampaignContext } from "./campaign-state";

export type OpponentPanelProps = { context: CampaignContext };

export function OpponentPanel({ context }: OpponentPanelProps) {
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
