import Link from "next/link";
import styles from "./travel.module.css";

export function TravelDeskEntry({
  atlasMode,
}: {
  atlasMode: string | null;
}) {
  const enabled = atlasMode === "atlas-v1";
  return (
    <section className={styles.entry} aria-labelledby="travel-desk-entry-title">
      <div>
        <p className={styles.kicker}>Travel publishing</p>
        <h2 id="travel-desk-entry-title">Postcard Planet</h2>
        <p>
          Build trips, deliberately coarsen locations, review the complete
          photo contact sheet, and publish the atlas as one safe snapshot.
        </p>
      </div>
      <div className={styles.entryAction}>
        <span className={enabled ? styles.enabled : styles.disabled}>
          Public atlas · {enabled ? "enabled" : "disabled"}
        </span>
        <Link href="/studio/travel">Open Travel Desk</Link>
      </div>
    </section>
  );
}
