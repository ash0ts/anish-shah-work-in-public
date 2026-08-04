import Link from "next/link";
import styles from "@/app/simulation/simulation.module.css";
import type { CampaignContext } from "./campaign-state";
import { buildConversationKey } from "./conversation-key";

export type EndingModelCardProps = {
  context: CampaignContext;
  onRestart: () => void;
  onExit: () => void;
};

export function EndingModelCard({
  context,
  onRestart,
  onExit,
}: EndingModelCardProps) {
  const key = buildConversationKey(context);

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
            {key.observations.map((fact) => (
              <li key={fact.id}>{fact.allowedStatement}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3>Two artifacts</h3>
          <ul>
            {key.workLinks.map((fact) => (
              <li key={fact.id}>
                <Link href={fact.href ?? "/work"}>{fact.title}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>One public doorway</h3>
          <p>
            <Link href={key.doorway?.route ?? "/play"}>
              {key.doorway?.label ?? "Explore Play"}
            </Link>
          </p>
        </section>
        <section>
          <h3>A better question</h3>
          <p>{key.question}</p>
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
        <Link href="/play" onClick={onExit}>
          Return to the room
        </Link>
      </div>
    </section>
  );
}
