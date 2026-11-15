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
        </nav>
      </section>
    </main>
  );
}
