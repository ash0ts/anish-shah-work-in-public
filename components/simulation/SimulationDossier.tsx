import Link from "next/link";
import type { SimulationDossier as SimulationDossierModel } from "./types";
import styles from "@/app/simulation/simulation.module.css";

const bucketLabels: Record<string, string> = {
  "products-open-source": "Systems and open source",
  "courses-learning": "Curricula and workshops",
  "writing-research": "Technical writing and implementations",
  "talks-programs": "Talks and public programs",
};

export function SimulationDossier({
  dossier,
}: {
  dossier: SimulationDossierModel;
}) {
  const groupedFacts = Object.entries(
    dossier.facts.reduce<Record<string, typeof dossier.facts>>(
      (groups, fact) => {
        (groups[fact.bucket] ??= []).push(fact);
        return groups;
      },
      {},
    ),
  );

  return (
    <section className={styles.dossier} aria-labelledby="dossier-title">
      <header className={styles.dossierHeader}>
        <p>Inspectable foundation</p>
        <h2 id="dossier-title">The public model’s source deck.</h2>
        <p className={styles.dossierSummary}>
          The game changes how these records meet you, not what they say. Every
          professional claim below links back to its canonical body of work.
        </p>
        <p
          aria-label={`${dossier.persona.accessibleName} disclosure`}
          className={styles.dossierDisclosure}
        >
          {dossier.persona.disclosure}
        </p>
      </header>

      <div className={styles.factColumns}>
        {groupedFacts.map(([bucket, facts]) => (
          <section className={styles.factColumn} key={bucket}>
            <h3>{bucketLabels[bucket] ?? bucket}</h3>
            <ol>
              {(facts ?? []).map((fact) => (
                <li key={fact.id}>
                  {fact.href ? (
                    <Link href={fact.href} prefetch={false}>
                      <strong>{fact.title}</strong>
                      <span>{fact.allowedStatement}</span>
                      <small>{fact.roleSummary}</small>
                    </Link>
                  ) : (
                    <div>
                      <strong>{fact.title}</strong>
                      <span>{fact.allowedStatement}</span>
                      <small>{fact.roleSummary}</small>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <div className={styles.dossierBottom}>
        <section aria-labelledby="signal-checkpoints-title">
          <h3 id="signal-checkpoints-title">Signal checkpoints</h3>
          <dl className={styles.metricList}>
            {dossier.metrics.map((metric) => (
              <div key={metric.id}>
                <dt>{metric.label}</dt>
                <dd>
                  <strong>{metric.displayValue}</strong>
                  <span>{metric.periodLabel}</span>
                  {metric.qualifier ? <small>{metric.qualifier}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <nav aria-labelledby="public-doorways-title">
          <h3 id="public-doorways-title">Six public doorways</h3>
          <ul className={styles.doorwayList}>
            {dossier.providerDoorways.map((doorway) => (
              <li key={doorway.provider}>
                <Link href={doorway.route} prefetch={false}>
                  {doorway.label}
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
          <p>
            Collection data adds texture to the game. It is never treated as a
            personality test.
          </p>
        </nav>
      </div>
    </section>
  );
}
