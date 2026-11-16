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
            <svg className={styles.rigGlyph} viewBox="0 0 140 100" aria-hidden="true" focusable="false">
              <path d="M24 32V5l5-3 5 4-3 28c9 6 6 14 13 22 12 17 1 34-13 34C9 90 6 73 18 60c7-8-3-17 6-28Z" fill="currentColor" />
              <rect x="27" y="32" width="4" height="39" fill="var(--paper)" />
              <rect x="52" y="43" width="81" height="45" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
              {[60, 82, 104].map(x => <rect key={x} x={x} y="50" width="16" height="24" rx="2" fill="currentColor" />)}
              <path d="M61 81h60" stroke="currentColor" strokeWidth="3" />
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
