import type { ReactNode } from "react";
import type { PreviewFixtureScenario } from "../connector-model";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import type { RoomObjectId } from "../room-platform/room-types";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

// Original instrument diagrams. These describe the object, never provider data.
const engravings: Record<RoomObjectId, ReactNode> = {
  rig: <><path d="M19 42V8h7v34c14 8 2 18 9 27 9 18-19 24-22 10-4-15 13-24 6-37ZM42 53h44v30H42zM48 60h10v12H48zM64 60h14v12H64zM50 78h25" /></>,
  watch: <><rect x="12" y="20" width="64" height="48" rx="8" /><path d="m28 8 16 12L60 8M22 30h44v28H22zM84 30v20M84 58v4M24 76h40" /></>,
  read: <><path d="M16 18h26l6 6 6-6h26v54H54l-6 6-6-6H16zM48 24v54M24 30h12M24 39h12M60 30h12M60 39h12" /><path d="M10 26v54h32M86 26v54H54" /></>,
  listen: <><rect x="13" y="15" width="70" height="66" rx="10" /><path d="M26 15v20h44V15M30 25h30M22 72h12M64 72h10" /><circle cx="48" cy="57" r="14" /><circle cx="48" cy="57" r="4" /></>,
  collect: <><path d="m15 34 7-18 55 7-3 17M12 36h72l-6 43H18zM26 49h44M24 58h48M29 68h38" /><path d="m30 29 4-6 26 4-1 5" /></>,
  play: <><path d="M13 16h70v49H13zM20 23h56v34H20zM39 65v10M57 65v10M28 79h40M27 33l7 6-7 6M43 47h16" /></>,
  move: <><path d="M17 16h62v43H17zM24 36h10l6-10 10 21 8-11h13M48 59v13M24 72h48l10 10H14z" /><circle cx="71" cy="51" r="2" /></>,
  travel: <><circle cx="48" cy="43" r="26" /><ellipse cx="48" cy="43" rx="12" ry="26" /><path d="M22 43h52M29 27h38M29 59h38M16 18c-20 50 47 80 67 24M48 77v7M32 86h32" /></>,
};

export function ObjectScreen({ id, fixture, children }: {
  id: RoomObjectId;
  fixture?: PreviewFixtureScenario;
  children: ReactNode;
}) {
  const object = ROOM_OBJECT_BY_ID[id];
  return (
    <main className={styles.page} data-room-screen data-object={id} id="main" tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.instrumentHeader}>
        <svg aria-hidden="true" className={styles.engraving} viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="1.5">
          {engravings[id]}
        </svg>
        <div>
          <p>{object.screenEyebrow}</p>
          <h1>{object.title}</h1>
        </div>
        <span>{object.description}</span>
      </header>
      <section className={styles.instrument} aria-label={object.title}>
        <div className={styles.hardwareEdge} aria-hidden="true"><i /><span /><i /></div>
        <MatchCutSurface className={styles.display} objectId={id} surface={object.matchCutSurface}>
          {children}
        </MatchCutSurface>
        <div className={styles.hardwareFoot} aria-hidden="true"><i /><i /><i /></div>
      </section>
    </main>
  );
}
