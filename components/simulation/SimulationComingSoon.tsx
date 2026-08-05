import Link from "next/link";

import { SITE_COPY } from "@/lib/copy";
import styles from "@/app/simulation/simulation.module.css";

export function SimulationComingSoon() {
  return (
    <section
      aria-labelledby="simulation-coming-soon-title"
      className={styles.comingSoon}
      data-simulation-coming-soon
    >
      <div aria-hidden="true" className={styles.comingSoonRobot}>
        <span className={styles.robotAntenna} />
        <span className={styles.robotHead}>
          <i />
          <i />
          <b>4N1SH</b>
        </span>
        <span className={styles.robotBody}>PUBLIC MODEL</span>
      </div>

      <div className={styles.comingSoonCopy}>
        <p>{SITE_COPY.simulation["coming-soon-eyebrow"]}</p>
        <h1 id="simulation-coming-soon-title">
          {SITE_COPY.simulation["coming-soon-title"]}
        </h1>
        <p>{SITE_COPY.simulation["coming-soon-summary"]}</p>
        <p className={styles.comingSoonDisclosure}>
          No model is running on this page. It creates no simulation session,
          loads no collection dossier, and sends no visitor text anywhere.
        </p>
        <nav aria-label="Simulation preview actions">
          <Link href="/play" prefetch={false}>
            {SITE_COPY.simulation["coming-soon-room-cta"]}
          </Link>
          <Link href="/work" prefetch={false}>
            {SITE_COPY.simulation["coming-soon-work-cta"]}
          </Link>
        </nav>
      </div>

      <aside className={styles.comingSoonConsole} aria-label="Build status">
        <p>{SITE_COPY.simulation["coming-soon-status"]}</p>
        <ol>
          <li><span>01</span> Grounding the model</li>
          <li><span>02</span> Writing the encounters</li>
          <li><span>03</span> Testing the exits</li>
        </ol>
        <strong>CAMPAIGN LOCKED</strong>
      </aside>
    </section>
  );
}
