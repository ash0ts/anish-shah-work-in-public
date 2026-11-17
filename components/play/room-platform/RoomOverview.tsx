import { rigShapes } from "@/lib/rig-artwork";
import Link from "next/link";
import type { PreviewFixtureScenario } from "../connector-model";
import { routeWithPreviewFixture } from "./preview-fixture-navigation";
import { ROOM_OBJECTS } from "./room-registry";
import { RoomEntryControl } from "./RoomEntryControl";
import { RevealSimulationControl } from "./RevealSimulationControl";
import styles from "./RoomOverview.module.css";
import { SITE_COPY } from "@/lib/copy";

export function RoomOverview({
  fixture,
  simulationEnabled = false,
  travelEnabled = false,
  directory = false,
}: {
  fixture?: PreviewFixtureScenario;
  simulationEnabled?: boolean;
  travelEnabled?: boolean;
  directory?: boolean;
}) {
  const objects = travelEnabled
    ? ROOM_OBJECTS
    : ROOM_OBJECTS.filter(({ id }) => id !== "travel");
  return (
    <main
      className={`site-main ${styles.page}`}
      data-room-overview
      id="main"
    >
      <link rel="preload" as="image" type="image/avif" fetchPriority="high"
        media="(max-width: 767px)" href="/assets/play/my-room-2001-neutral-mobile.cb7ee0619308.avif" />
      <link rel="preload" as="image" type="image/avif" fetchPriority="high"
        media="(min-width: 768px)" href="/assets/play/my-room-2001-neutral.4edcf2c380f5.avif" />
      <header className={styles.intro}>
        <h1>{SITE_COPY.play["intro-title"]}</h1>
        <div>
          <RoomEntryControl directory={directory} href={routeWithPreviewFixture("/play", fixture)} />
          {simulationEnabled ? (
            <div className={styles.simulationIngress}>
              <RevealSimulationControl />
            </div>
          ) : null}
        </div>
      </header>

      <section
        className={styles.poster}
        data-room-static-stage
        aria-labelledby="room-directory-title"
      >
        <div className={styles.posterField} aria-hidden="true">
          <picture>
            <source
              media="(max-width: 767px)"
              srcSet="/assets/play/my-room-2001-neutral-mobile.cb7ee0619308.avif"
              type="image/avif"
            />
            <source
              srcSet="/assets/play/my-room-2001-neutral.4edcf2c380f5.avif"
              type="image/avif"
            />
            <source
              media="(max-width: 767px)"
              srcSet="/assets/play/my-room-2001-neutral-mobile.e1cc0d1ad2de.webp"
              type="image/webp"
            />
            <img
              alt=""
              decoding="async"
              fetchPriority="high"
              height="1000"
              loading="eager"
              sizes="(max-width: 767px) calc(100vw - 2rem), 60vw"
              src="/assets/play/my-room-2001-neutral.30364e150078.webp"
              width="1600"
            />
          </picture>
        </div>
        <nav className={styles.directory} aria-labelledby="room-directory-title">
          <header>
            <h2 id="room-directory-title">{SITE_COPY.play["directory-title"]}</h2>
          </header>
          <ol>
            {objects.map((object) => (
              <li key={object.id}>
                <Link
                  data-room-object-link={object.id}
                  href={routeWithPreviewFixture(object.route, fixture)}
                  prefetch={false}
                >
                  <strong>{object.object}</strong>
                  <small>{object.label}</small>
                  <b aria-hidden="true">↗</b>
                </Link>
              </li>
            ))}
          </ol>
          <Link
            className={styles.rigLink}
            data-play-rig-link
            href="/play/rig"
            prefetch={false}
          >
            <svg className={styles.rigGlyph} viewBox="0 0 160 110" aria-hidden="true" focusable="false">
              {[0,28].map((x,i)=><g key={x} transform={`translate(${x} ${i*7})`}><path d={rigShapes.directoryGuitar} fill="currentColor"/><path d="M23 17v62" stroke="var(--paper)" strokeWidth="2"/></g>)}
              <rect x="76" y="21" width="76" height="25" rx="3" fill="none" stroke="currentColor" strokeWidth="3"/>
              <path d="M80 37h68m-60 0v7m10-7v7m10-7v7m10-7v7m10-7v7m10-7v7" stroke="currentColor" strokeWidth="2"/>
              <rect x="113" y="59" width="39" height="42" rx="3" fill="none" stroke="currentColor" strokeWidth="3"/>
              <path d="M123 59v-6h19v6M117 69h31" fill="none" stroke="currentColor" strokeWidth="3"/>
              <rect x="65" y="67" width="39" height="34" rx="3" fill="none" stroke="currentColor" strokeWidth="3"/>
              {[71,82,93].map(x=><rect key={x} x={x} y="73" width="6" height="13" fill="currentColor"/>)}
              <path d="M71 94h27" stroke="currentColor" strokeWidth="3"/>
            </svg>
            <strong>{SITE_COPY.play["rig-title"]}</strong>
            <small>{SITE_COPY.play["rig-directory-label"]}</small>
            <b aria-hidden="true">↗</b>
          </Link>
        </nav>
      </section>
    </main>
  );
}
