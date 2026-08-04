"use client";

import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Room3DGate } from "../room-3d/Room3DGate";
import type { RoomCapabilityResult } from "../room-3d/room-capability";
import { ROOM_OBJECTS } from "./room-registry";
import { useRoomExperience } from "./RoomExperienceProvider";
import styles from "./RoomRuntime.module.css";

const LazyRoomStage = lazy(() =>
  import("../room-3d/RoomStage").then((module) => ({
    default: module.RoomStage,
  })),
);

class RoomRuntimeBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function RoomPosterFallback({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className={styles.posterFallback} role="status">
      <picture>
        <source
          srcSet="/assets/play/my-room-2001-neutral.50f82f186444.avif"
          type="image/avif"
        />
        <img
          alt=""
          decoding="async"
          height="1000"
          src="/assets/play/my-room-2001-neutral.af662c65ec99.webp"
          width="1600"
        />
      </picture>
      <p>
        <strong>{title}</strong>
        <span>{detail}</span>
      </p>
    </div>
  );
}

const CAPABILITY_MESSAGES: Record<string, string> = {
  checking: "Checking this device for the interactive room.",
  "coarse-pointer": "The still room is easier to use with this pointer.",
  "document-hidden": "The still room paused while this page was in the background.",
  "forced-colors": "The still room respects this high-contrast display mode.",
  "narrow-viewport": "The still room is composed for this screen size.",
  "reduced-motion": "The still room respects reduced-motion preferences.",
  "save-data": "The still room avoids the 3D download while Save-Data is on.",
  "webgl2-unavailable": "The still room is available without WebGL.",
  zoomed: "The still room remains readable at this zoom level.",
};

function capabilityDetail(capability: RoomCapabilityResult | null) {
  if (!capability || capability.reasons.length === 0) {
    return "Every collection remains available through the object directory.";
  }
  return capability.reasons
    .map(
      (reason) =>
        CAPABILITY_MESSAGES[reason] ??
        "Every collection remains available through the object directory.",
    )
    .join(" ");
}

export function RoomRuntime() {
  const room = useRoomExperience();
  const notifyRuntimeMounted = room.notifyRuntimeMounted;
  const setRoomFallback = room.setFallback;
  const runtimeRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [capability, setCapability] = useState<RoomCapabilityResult | null>(null);
  const returning = room.phase === "returning";
  const presenting = room.objectRouteActive && !returning;
  const blocked = presenting || returning;
  const capabilityChanged = useCallback((result: RoomCapabilityResult) => {
    setCapability(result);
  }, []);
  const markReady = useCallback(() => setReady(true), []);
  const reportContextLoss = useCallback(
    () => setRoomFallback("webgl-context-lost"),
    [setRoomFallback],
  );
  const reportRuntimeFailure = useCallback(
    () => setRoomFallback("room-runtime-failed"),
    [setRoomFallback],
  );

  useEffect(() => {
    notifyRuntimeMounted();
  }, [notifyRuntimeMounted]);

  const atLeftBound = room.rotation.y <= -12;
  const atRightBound = room.rotation.y >= 12;
  const atUpperBound = room.rotation.x <= -7;
  const atLowerBound = room.rotation.x >= 7;

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || presenting) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const controls = [
      ...runtime.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hasAttribute("inert"));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1) ?? first;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !runtime.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !runtime.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section
      aria-hidden={blocked || undefined}
      aria-busy={returning || undefined}
      aria-label="Interactive room"
      aria-modal="true"
      className={styles.runtime}
      data-room-ready={ready ? "true" : "false"}
      data-room-runtime
      data-room-transition-phase={room.phase}
      data-presenting={presenting}
      data-returning={returning || undefined}
      inert={blocked}
      onKeyDown={containFocus}
      ref={runtimeRef}
      role="dialog"
    >
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles.announcer}
        data-room-runtime-announcer
        role="status"
      >
        {room.statusMessage}
      </p>
      <div className={styles.runtimeBar}>
        <span>
          My Room, 2001
          <small>{ready ? "Room ready" : "Preparing room"}</small>
        </span>
        <button
          data-room-runtime-entry-focus
          onClick={room.exitRoom}
          type="button"
        >
          Leave room
        </button>
      </div>

      <div className={styles.stageSlot} data-room-stage-shell>
        <Room3DGate
          fallback={
            <RoomPosterFallback
              detail={capabilityDetail(capability)}
              title="The room is staying still on this device."
            />
          }
          onCapabilityChange={capabilityChanged}
        >
          <RoomRuntimeBoundary onFailure={reportRuntimeFailure}>
            <Suspense fallback={null}>
              <LazyRoomStage
                focusedId={room.focusedId}
                onContextLoss={reportContextLoss}
                onHoverChange={room.focusObject}
                onReady={markReady}
                onRotationChange={room.rotate}
                onSelect={room.selectObject}
                rotation={room.rotation}
                selectedId={room.selectedId}
              />
            </Suspense>
            {!ready ? (
              <RoomPosterFallback
                detail="The object links are ready below."
                title="Setting out the room…"
              />
            ) : null}
          </RoomRuntimeBoundary>
        </Room3DGate>
        {room.focusedId ? (
          <p aria-hidden="true" className={styles.objectCue} data-room-object-cue>
            <span>{ROOM_OBJECTS.find(({ id }) => id === room.focusedId)?.object}</span>
            <strong>{ROOM_OBJECTS.find(({ id }) => id === room.focusedId)?.label}</strong>
          </p>
        ) : null}
      </div>

      <div className={styles.controls} aria-label="Room view controls" role="group">
        <button
          aria-disabled={atLeftBound}
          disabled={atLeftBound}
          onClick={() => room.rotate({ x: room.rotation.x, y: room.rotation.y - 4 })}
          type="button"
        >
          Turn left
        </button>
        <button
          aria-disabled={atRightBound}
          disabled={atRightBound}
          onClick={() => room.rotate({ x: room.rotation.x, y: room.rotation.y + 4 })}
          type="button"
        >
          Turn right
        </button>
        <button
          aria-disabled={atUpperBound}
          disabled={atUpperBound}
          onClick={() => room.rotate({ x: room.rotation.x - 4, y: room.rotation.y })}
          type="button"
        >
          Tilt up
        </button>
        <button
          aria-disabled={atLowerBound}
          disabled={atLowerBound}
          onClick={() => room.rotate({ x: room.rotation.x + 4, y: room.rotation.y })}
          type="button"
        >
          Tilt down
        </button>
        <button onClick={room.resetView} type="button">
          Reset view
        </button>
      </div>

      <nav className={styles.objects} aria-label="Objects in the room">
        <ol>
          {ROOM_OBJECTS.map((object) => (
            <li key={object.id}>
              <button
                aria-pressed={room.selectedId === object.id}
                data-focused={room.focusedId === object.id || undefined}
                data-room-object-control={object.id}
                data-room-object-link={object.id}
                onClick={() => room.selectObject(object.id)}
                onFocus={() => room.focusObject(object.id)}
                onMouseEnter={() => room.focusObject(object.id)}
                onMouseLeave={() => room.focusObject(null)}
                type="button"
              >
                <span>{object.object}</span>
                <strong>{object.label}</strong>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
