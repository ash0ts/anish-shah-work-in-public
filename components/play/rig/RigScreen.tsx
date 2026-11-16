import Link from "next/link";
import { orderedSignalChain } from "@/lib/gear";
import { SITE_COPY } from "@/lib/copy";
import type { GearManifest, GearStatus } from "@/types/gear";
import styles from "./RigScreen.module.css";

const benchStatuses: GearStatus[] = ["incoming", "planned", "optional"];

export function RigScreen({ manifest }: { manifest: GearManifest }) {
  const chain = orderedSignalChain(manifest.items);
  return (
    <main className={styles.page} data-gear-rig id="main">
      <nav aria-label="Rig navigation" className={styles.nav}>
        <Link href="/play" prefetch={false}>← Back to room</Link>
        <span>{SITE_COPY.play["rig-screen-eyebrow"]}</span>
      </nav>

      <header className={styles.header}>
        <div>
          <p>{SITE_COPY.play["rig-screen-eyebrow"]}</p>
          <h1>{SITE_COPY.play["rig-screen-title"]}</h1>
        </div>
        <p>{SITE_COPY.play["rig-description"]}</p>
      </header>

      <section aria-labelledby="signal-chain-title" className={styles.rig}>
        <header>
          <span aria-hidden="true" className={styles.pickups}>▥</span>
          <div>
            <p>Live wiring sketch</p>
            <h2 id="signal-chain-title">Signal chain</h2>
          </div>
          <span aria-hidden="true" className={styles.amp}>◖</span>
        </header>
        <ol className={styles.chain}>
          {chain.map((item, index) => (
            <li className={styles.pedal} data-group={item.chainGroup} key={item.id}>
              <span className={styles.order}>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.model}</strong>
              <small>{item.brand}</small>
              <details>
                <summary>Patch note</summary>
                <p>{item.note}</p>
              </details>
            </li>
          ))}
        </ol>
        <p className={styles.privateNote}>{manifest.profile.publicNote}</p>
      </section>

      <section aria-labelledby="bench-title" className={styles.bench}>
        <header>
          <p>Collection status</p>
          <h2 id="bench-title">Workbench</h2>
        </header>
        <div className={styles.benchGrid}>
          {benchStatuses.map((status) => {
            const items = manifest.items.filter((item) => item.status === status);
            if (!items.length) return null;
            return (
              <section aria-labelledby={`gear-${status}`} key={status}>
                <h3 id={`gear-${status}`}>{manifest.statusLabels[status]}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.model}</strong>
                      <span>{item.brand}</span>
                      <small>{item.note}</small>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>

      <footer className={styles.footer}>
        <p>Equipboard remains a linked catalog, not the live database. This checked-in manifest is the public source of truth.</p>
        {manifest.profile.equipboardProfileUrl ? (
          <a href={manifest.profile.equipboardProfileUrl} rel="noreferrer">Open Equipboard profile ↗</a>
        ) : (
          <span>Add the Equipboard profile URL after the collection is created.</span>
        )}
      </footer>
    </main>
  );
}
