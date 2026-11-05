"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { animate } from "animejs";
import { SITE_COPY } from "@/lib/copy";
import { WORKSPACE_MESSAGES } from "@/lib/simulation/conversation-messages";
import type {
  DocumentedConnection,
  InternetObject,
} from "@/lib/simulation/personal-internet";
import { ObjectSprite } from "./ObjectSprite";
import styles from "./MediaConsole.module.css";

type Reader = 0 | 1;
type Props = {
  objects: InternetObject[];
  catalog: InternetObject[];
  readers: [string | null, string | null];
  connection: DocumentedConnection | null;
  still: boolean;
  ready: boolean;
  load: (id: string, reader: Reader) => void;
  eject: (reader: Reader) => void;
  connect: () => void;
  inspect: (object: InternetObject, origin: HTMLElement) => void;
  ask: (ids: string[], origin: HTMLElement) => void;
};
const copy = SITE_COPY.simulation;
const motionAllowed = (still: boolean) =>
  !still &&
  !document.hidden &&
  !matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)")
    .matches;

/** A local input toy: pointer gestures and buttons dispatch the same ID-only actions. */
export function MediaConsole({
  objects,
  catalog,
  readers,
  connection,
  still,
  ready,
  load,
  eject,
  connect,
  inspect,
  ask,
}: Props) {
  const [index, setIndex] = useState(0);
  const [hoverReader, setHoverReader] = useState<Reader | null>(null);
  const [pulse, setPulse] = useState(0);
  const [reaction, setReaction] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const machine = useRef<HTMLDivElement>(null);
  const monitor = useRef<HTMLDivElement>(null);
  const character = useRef<HTMLButtonElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const sockets = useRef<Array<HTMLButtonElement | null>>([]);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    target: HTMLElement;
  } | null>(null);
  const suppressClick = useRef(false);
  const animations = useRef<Array<ReturnType<typeof animate>>>([]);
  const active = objects[index % Math.max(objects.length, 1)];
  const loaded = readers.map((id) =>
    catalog.find((object) => object.id === id),
  );
  const current = loaded[1] ?? loaded[0];
  const occupied = readers.filter((id): id is string => !!id);

  function resetDrag() {
    const gesture = drag.current;
    drag.current = null;
    if (gesture?.target.hasPointerCapture(gesture.id))
      gesture.target.releasePointerCapture(gesture.id);
    if (media.current) media.current.style.transform = "";
    setHoverReader(null);
    setDragging(false);
  }
  useEffect(() => {
    const cancel = () => {
      if (drag.current?.moved) suppressClick.current = true;
      const gesture = drag.current;
      drag.current = null;
      if (gesture?.target.hasPointerCapture(gesture.id))
        gesture.target.releasePointerCapture(gesture.id);
      if (media.current) media.current.style.transform = "";
      if (machine.current) machine.current.style.transform = "";
      setHoverReader(null);
      setDragging(false);
      setPulse(0);
      setPaused(document.hidden);
      animations.current.forEach((motion) => motion.revert());
      animations.current = [];
    };
    const secondPointer = (event: globalThis.PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.id) cancel();
    };
    const preference = matchMedia(
      "(prefers-reduced-motion: reduce), (forced-colors: active)",
    );
    document.addEventListener("pointerdown", secondPointer, true);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("resize", cancel);
    preference.addEventListener("change", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", secondPointer, true);
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("resize", cancel);
      preference.removeEventListener("change", cancel);
    };
  }, [still]);

  function feedback(kind: "load" | "patch" | "poke") {
    setPulse((value) => value + 1);
    if (!motionAllowed(still)) return;
    animations.current.forEach((animation) => animation.revert());
    animations.current = [];
    if (character.current)
      animations.current.push(
        animate(character.current, {
          translateY: [0, kind === "poke" ? -38 : -15, 0],
          rotate: [0, -9, 8, 0],
          scale: [1, 1.12, 1],
          duration: 650,
          ease: "outBack",
        }),
      );
  }
  function insert(reader: Reader) {
    if (!active) return;
    load(active.id, reader);
    feedback("load");
  }
  function browse(next: number) {
    resetDrag();
    setIndex((next + objects.length) % Math.max(objects.length, 1));
  }
  function targetReader(x: number, y: number): Reader | null {
    for (const reader of [0, 1] as const) {
      const rect = sockets.current[reader]?.getBoundingClientRect();
      if (
        rect &&
        x >= rect.left - 12 &&
        x <= rect.right + 12 &&
        y >= rect.top - 12 &&
        y <= rect.bottom + 12
      )
        return reader;
    }
    return null;
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.id || !media.current) return;
    const x = event.clientX - gesture.x;
    const y = event.clientY - gesture.y;
    gesture.moved ||= Math.hypot(x, y) > 10;
    if (!gesture.moved) return;
    setDragging(true);
    media.current.style.transform = `translate3d(${x}px, ${y}px, 100px) rotate(${Math.max(-12, Math.min(12, x / 20))}deg) scale(1.05)`;
    setHoverReader(targetReader(event.clientX, event.clientY));
  }
  function release(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.id) return;
    const reader = gesture.moved
      ? targetReader(event.clientX, event.clientY)
      : null;
    suppressClick.current = gesture.moved;
    resetDrag();
    if (reader !== null) insert(reader);
  }

  return (
    <div
      className={styles.playground}
      data-still={still || paused}
      data-ready={ready}
      data-patched={!!connection}
    >
      <div className={styles.horizon} aria-hidden="true" />
      <div className={styles.introduction}>
        <p>{copy["console-invitation"]}</p>
        <small>{copy["console-hint"]}</small>
      </div>
      <div
        className={styles.machineSpace}
        onPointerMove={(event) => {
          if (
            !machine.current ||
            event.pointerType !== "mouse" ||
            drag.current ||
            !motionAllowed(still)
          )
            return;
          const rect = event.currentTarget.getBoundingClientRect();
          machine.current.style.setProperty(
            "--light-x",
            `${((event.clientX - rect.left) / rect.width) * 100}%`,
          );
          machine.current.style.setProperty(
            "--light-y",
            `${((event.clientY - rect.top) / rect.height) * 100}%`,
          );
        }}
      >
        <div ref={machine} className={styles.machine}>
          <div className={styles.topEdge}>
            <span>4N1SH / LINK UNIT</span>
            <i aria-hidden="true" />{" "}
            <span>{String(objects.length).padStart(2, "0")} MEDIA</span>
          </div>
          <div className={styles.screenBezel}>
            <div ref={monitor} className={styles.screen} data-pulse={pulse}>
              <div className={styles.screenGrid} aria-hidden="true" />
              {pulse > 0 && (
                <div key={pulse} className={styles.scan} aria-hidden="true" />
              )}
              <div className={styles.screenTop}>
                <span>● {occupied.length ? "READING" : "STANDBY"}</span>
                <span>LOCAL / NO AI REQUEST</span>
              </div>
              <button
                ref={character}
                className={styles.character}
                disabled={!ready}
                aria-label="Nudge 4N1SH"
                onClick={() => {
                  setReaction(!reaction);
                  feedback("poke");
                }}
                data-reaction={reaction}
              >
                <span className={styles.characterArt} aria-hidden="true" />
                <span className={styles.characterFallback}>4N1SH</span>
              </button>
              <div className={styles.readout}>
                {connection ? (
                  <section aria-label="Documented connection">
                    <small>A ↔ B</small>
                    <h2>
                      {connection.supported
                        ? copy["connection-found"]
                        : copy["connection-missing"]}
                    </h2>
                    <div className={styles.topicNodes}>
                      {connection.topics.map((topic) => (
                        <span key={topic.id}>{topic.label}</span>
                      ))}
                    </div>
                    <p className={styles.limit}>
                      {WORKSPACE_MESSAGES.connectionLimit}
                    </p>
                    <button
                      className={styles.screenAction}
                      onClick={(event) =>
                        ask(connection.ids, event.currentTarget)
                      }
                    >
                      {copy["ask-pair"]} ↗
                    </button>
                  </section>
                ) : current ? (
                  <>
                    <small>
                      {current.period} / {current.kind}
                    </small>
                    <h2>{current.label}</h2>
                    {occupied.length === 1 && (
                      <p className={styles.limit}>{copy["console-loaded"]}</p>
                    )}
                    <div className={styles.topicNodes}>
                      {current.topics.slice(0, 3).map((topic) => (
                        <span key={topic.id}>{topic.label}</span>
                      ))}
                    </div>
                    <div className={styles.screenActions}>
                      <button
                        className={styles.screenAction}
                        onClick={(event) =>
                          inspect(current, event.currentTarget)
                        }
                      >
                        {copy["inspect-loaded"]} ↗
                      </button>
                      <button
                        className={styles.screenAction}
                        onClick={(event) => ask(occupied, event.currentTarget)}
                      >
                        {copy["ask-label"]} ↗
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.idleGlyph} aria-hidden="true">
                      ✳
                    </span>
                    <h2>{copy["console-idle"]}</h2>
                    <div className={styles.idleDiagram} aria-hidden="true">
                      <span>A</span>
                      <i />
                      <span>4N1SH</span>
                      <i />
                      <span>B</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.readers}>
            {([0, 1] as const).map((reader) => (
              <div
                key={reader}
                className={styles.reader}
                data-active={!!loaded[reader]}
                data-hover={hoverReader === reader}
              >
                <button
                  ref={(element) => {
                    sockets.current[reader] = element;
                  }}
                  className={styles.readerTarget}
                  disabled={!ready || !active}
                  aria-label={`${copy["load-reader"]} ${reader === 0 ? "A" : "B"}`}
                  onClick={() => insert(reader)}
                >
                  <span className={styles.socketLabel}>
                    {reader === 0 ? "A" : "B"}
                    <i aria-hidden="true" />
                  </span>
                  <span className={styles.slot} aria-hidden="true">
                    <span />
                  </span>
                  <strong>
                    {loaded[reader]?.label ?? copy["reader-empty"]}
                  </strong>
                </button>
                <button
                  className={styles.eject}
                  disabled={!loaded[reader]}
                  aria-label={`${copy["eject-reader"]} ${reader === 0 ? "A" : "B"}`}
                  onClick={() => {
                    eject(reader);
                    feedback("load");
                  }}
                >
                  ⏏
                </button>
              </div>
            ))}
            <button
              className={styles.patch}
              disabled={occupied.length !== 2}
              onClick={() => {
                connect();
                feedback("patch");
              }}
            >
              <span aria-hidden="true">⤨</span>
              {copy["patch-readers"]}
            </button>
          </div>
          <div className={styles.underside} aria-hidden="true">
            <i />
            <span>◢ ◢ ◢ ◢ ◢ ◢</span>
            <i />
          </div>
        </div>
      </div>
      <div className={styles.mediaShelf} data-dragging={dragging}>
        <div className={styles.carousel} aria-label={copy["tune-label"]}>
          {objects.map((object, objectIndex) => {
            let distance =
              (objectIndex - index + objects.length) % objects.length;
            if (distance > objects.length / 2) distance -= objects.length;
            return (
              <div
                key={object.id}
                className={styles.cartridge}
                data-active={distance === 0}
                data-near={Math.abs(distance) <= 1}
                style={{ "--offset": distance } as CSSProperties}
              >
                <div
                  ref={distance === 0 ? media : undefined}
                  className={styles.cartridgeMotion}
                >
                  <button
                    disabled={!ready}
                    tabIndex={distance === 0 ? 0 : -1}
                    aria-hidden={Math.abs(distance) > 1 || undefined}
                    aria-label={`Insert ${object.label}`}
                    className={styles.grab}
                    onPointerDown={(event) => {
                      if (
                        distance !== 0 ||
                        !event.isPrimary ||
                        event.button !== 0 ||
                        !motionAllowed(still)
                      )
                        return;
                      suppressClick.current = false;
                      drag.current = {
                        id: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                        target: event.currentTarget,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={move}
                    onPointerUp={release}
                    onPointerCancel={() => {
                      suppressClick.current = true;
                      resetDrag();
                    }}
                    onLostPointerCapture={() => {
                      if (drag.current) {
                        suppressClick.current = true;
                        resetDrag();
                      }
                    }}
                    onClick={(event) => {
                      if (suppressClick.current && event.detail !== 0) {
                        suppressClick.current = false;
                        return;
                      }
                      suppressClick.current = false;
                      if (distance !== 0) browse(objectIndex);
                      else insert(!readers[0] ? 0 : 1);
                    }}
                  >
                    <ObjectSprite kind={object.kind} variant={objectIndex} />
                    <span className={styles.cartridgeLabel}>
                      {object.label}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.tuner}>
          <button
            disabled={!ready || !objects.length}
            aria-label={copy["previous-object"]}
            onClick={() => browse(index - 1)}
          >
            ←
          </button>
          <div
            className={styles.dial}
            style={{ "--angle": `${index * 48 - 120}deg` } as CSSProperties}
          >
            <span aria-hidden="true" />
            <input
              aria-label={copy["tune-label"]}
              type="range"
              min={0}
              max={Math.max(0, objects.length - 1)}
              value={index}
              disabled={!ready || !objects.length}
              onChange={(event) => browse(Number(event.target.value))}
            />
          </div>
          <button
            disabled={!ready || !objects.length}
            aria-label={copy["next-object"]}
            onClick={() => browse(index + 1)}
          >
            →
          </button>
          <output aria-live="polite">
            {active?.label ?? copy["journal-empty"]}
            <small>
              {objects.length
                ? `${String(index + 1).padStart(2, "0")} / ${String(objects.length).padStart(2, "0")}`
                : "—"}
            </small>
          </output>
        </div>
      </div>
    </div>
  );
}
