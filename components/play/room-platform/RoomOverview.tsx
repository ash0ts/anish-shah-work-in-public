import Link from "next/link";
import type { PreviewFixtureScenario } from "../connector-model";
import { routeWithPreviewFixture } from "./preview-fixture-navigation";
import { ROOM_OBJECTS } from "./room-registry";
import { RoomEntryControl } from "./RoomEntryControl";
import styles from "./RoomOverview.module.css";

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
        <p>My Room, 2001 · Six public collections</p>
        <h1>Come in. Pick something up.</h1>
        <div>
          <p>
            A low-poly room for the things outside the work: anime, books,
            music, records, games, and movement. Every object still opens as a
            normal page.
          </p>
          <RoomEntryControl />
        </div>
      </header>

      <section className={styles.poster} aria-labelledby="room-directory-title">
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
            <span>Still room</span>
            <b>Enter on capable desktop browsers</b>
          </p>
        </div>
        <nav className={styles.directory} aria-labelledby="room-directory-title">
          <header>
            <p>Object directory</p>
            <h2 id="room-directory-title">Six ways into the room.</h2>
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
