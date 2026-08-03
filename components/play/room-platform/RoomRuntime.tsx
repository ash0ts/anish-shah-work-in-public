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

export function RoomRuntime() {
  const room = useRoomExperience();
  const notifyRuntimeMounted = room.notifyRuntimeMounted;
  const runtimeRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [capability, setCapability] = useState<RoomCapabilityResult | null>(null);
  const presenting = room.objectRouteActive;
  const capabilityChanged = useCallback((result: RoomCapabilityResult) => {
    setCapability(result);
  }, []);

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
      aria-hidden={presenting || undefined}
      aria-label="Interactive room"
      aria-modal="true"
      className={styles.runtime}
      data-room-runtime
      data-room-transition-phase={room.phase}
      data-presenting={presenting}
      inert={presenting}
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

      <Room3DGate
        fallback={
          <div className={styles.fallback} role="status">
            <strong>The room is staying still on this device.</strong>
            <p>
              Use the six labeled objects below. Every collection remains
              available without WebGL or motion.
            </p>
            {capability?.reasons.length ? (
              <small>{capability.reasons.join(" · ")}</small>
            ) : null}
          </div>
        }
        onCapabilityChange={capabilityChanged}
      >
        <RoomRuntimeBoundary
          onFailure={() => room.setFallback("room-runtime-failed")}
        >
          <Suspense
            fallback={
              <div className={styles.fallback} role="status">
                <strong>Setting out the room…</strong>
                <p>The object directory is already available.</p>
              </div>
            }
          >
            <LazyRoomStage
              focusedId={room.focusedId}
              onContextLoss={() => room.setFallback("webgl-context-lost")}
              onHoverChange={room.focusObject}
              onReady={() => setReady(true)}
              onRotationChange={room.rotate}
              onSelect={room.selectObject}
              rotation={room.rotation}
              selectedId={room.selectedId}
            />
          </Suspense>
        </RoomRuntimeBoundary>
      </Room3DGate>

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
