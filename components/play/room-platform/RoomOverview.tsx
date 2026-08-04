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
}: {
  fixture?: PreviewFixtureScenario;
}) {
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
            <p>There is another signal behind the room.</p>
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
              srcSet="/assets/play/my-room-2001-neutral.50f82f186444.avif"
              type="image/avif"
            />
            <img
              alt=""
              decoding="async"
              height="1000"
              loading="eager"
              src="/assets/play/my-room-2001-neutral.af662c65ec99.webp"
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
            {ROOM_OBJECTS.map((object, index) => (
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
