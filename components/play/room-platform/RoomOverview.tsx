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
}: {
  fixture?: PreviewFixtureScenario;
  simulationEnabled?: boolean;
  travelEnabled?: boolean;
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
      <header className={styles.intro}>
        <p>{SITE_COPY.play["intro-eyebrow"]}</p>
        <h1>{SITE_COPY.play["intro-title"]}</h1>
        <div>
          <p>{SITE_COPY.play["intro-summary"]}</p>
          <RoomEntryControl />
          {simulationEnabled ? (
            <div className={styles.simulationIngress}>
              <p>{SITE_COPY.simulation["ingress-label"]}</p>
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
              srcSet="/assets/play/my-room-2001-neutral-mobile.27b17548d9bf.avif"
              type="image/avif"
            />
            <source
              srcSet="/assets/play/my-room-2001-neutral.01c6f825bbc1.avif"
              type="image/avif"
            />
            <img
              alt=""
              decoding="async"
              fetchPriority="high"
              height="1000"
              loading="eager"
              sizes="(max-width: 767px) calc(100vw - 2rem), 60vw"
              src="/assets/play/my-room-2001-neutral.00d2bc80d8dc.webp"
              srcSet="/assets/play/my-room-2001-neutral-mobile.95603956f4ee.webp 640w, /assets/play/my-room-2001-neutral.00d2bc80d8dc.webp 1600w"
              width="1600"
            />
          </picture>
          <p>
            <span>{SITE_COPY.play["poster-still-label"]}</span>
            <b>{SITE_COPY.play["poster-capable-label"]}</b>
          </p>
        </div>
        <nav className={styles.directory} aria-labelledby="room-directory-title">
          <header>
            <p>{SITE_COPY.play["directory-eyebrow"]}</p>
            <h2 id="room-directory-title">{SITE_COPY.play["directory-title"]}</h2>
          </header>
          <ol>
            {objects.map((object, index) => (
              <li key={object.id}>
                <Link
                  data-room-object-link={object.id}
                  href={routeWithPreviewFixture(object.route, fixture)}
                  prefetch={false}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{object.roomLabel}</strong>
                  <small>{object.description}</small>
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
