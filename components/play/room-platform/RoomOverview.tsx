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
  travelEnabled = false,
}: {
  fixture?: PreviewFixtureScenario;
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
          <div className={styles.simulationIngress}>
            <p>{SITE_COPY.simulation["ingress-label"]}</p>
            <RevealSimulationControl />
          </div>
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
              srcSet="/assets/play/my-room-2001-neutral.01c6f825bbc1.avif"
              type="image/avif"
            />
            <img
              alt=""
              decoding="async"
              height="1000"
              loading="eager"
              src="/assets/play/my-room-2001-neutral.00d2bc80d8dc.webp"
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
