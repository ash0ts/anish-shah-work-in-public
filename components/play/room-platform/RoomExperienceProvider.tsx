"use client";

import { animate } from "animejs";
import { usePathname, useRouter } from "next/navigation";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import { SITE_COPY } from "@/lib/copy";
import {
  Component,
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { isRoomObjectId, ROOM_OBJECT_BY_ID } from "./room-registry";
import {
  previewFixtureFromSearch,
  routeWithPreviewFixture,
} from "./preview-fixture-navigation";
import {
  INITIAL_ROOM_STATE,
  roomExperienceReducer,
} from "./room-reducer";
import styles from "./RoomExperienceProvider.module.css";
import type {
  RoomExperienceState,
  RoomObjectId,
  RoomRotation,
} from "./room-types";

type RoomExperienceContextValue = RoomExperienceState & {
  cancelSimulationReveal(): void;
  enterRoom(): void;
  exitRoom(): void;
  focusObject(id: RoomObjectId | null): void;
  resetView(): void;
  returnToRoom(): void;
  rotate(rotation: RoomRotation): void;
  setFallback(reason: string): void;
  selectObject(id: RoomObjectId): void;
  notifyRuntimeMounted(): void;
  objectRouteActive: boolean;
  enabledObjectIds: readonly RoomObjectId[];
  revealSimulation(): void;
  simulationEnabled: boolean;
  simulationTransitioning: boolean;
  statusMessage: string;
};

type ObjectRouteOrigin = "direct" | "room";

const ROOM_HISTORY_ORIGIN_KEY = "__anishRoomOrigin";
const ROOM_HISTORY_DEPTH_KEY = "__anishRoomDepth";
const ROOM_HISTORY_PATH_KEY = "__anishRoomPath";

const RoomExperienceContext = createContext<RoomExperienceContextValue | null>(
  null,
);

const LazyRoomRuntime = lazy(() =>
  import("./RoomRuntime").then((module) => ({ default: module.RoomRuntime })),
);

let sessionRoomFailure: string | null = null;

class LazyRoomBoundary extends Component<
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

function LazyRoomFallback({ onLeave }: { onLeave: () => void }) {
  const leaveRef = useRef<HTMLButtonElement>(null);

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    leaveRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      leaveRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      aria-label="Interactive room"
      aria-modal="true"
      className={styles.runtimeLoading}
      data-room-runtime-loading
      onKeyDown={containFocus}
      role="dialog"
    >
      <picture>
        <source
          srcSet="/assets/play/my-room-2001-neutral.01c6f825bbc1.avif"
          type="image/avif"
        />
        <img
          alt=""
          decoding="async"
          height="1000"
          src="/assets/play/my-room-2001-neutral.00d2bc80d8dc.webp"
          width="1600"
        />
      </picture>
      <div>
        <p role="status">Opening room</p>
        <button onClick={onLeave} ref={leaveRef} type="button">
          Leave room
        </button>
      </div>
    </section>
  );
}

function ReturnSignal({ objectId }: { objectId: RoomObjectId }) {
  const object = ROOM_OBJECT_BY_ID[objectId];

  return (
    <section
      aria-atomic="true"
      aria-label="Returning to the interactive room"
      aria-live="assertive"
      className={styles.returnSignal}
      data-room-return-status
      role="status"
      tabIndex={-1}
    >
      <div className={styles.returnSignalPanel}>
        <div aria-hidden="true" className={styles.returnSignalPicture}>
          <span>ROOM 01</span>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className={styles.returnSignalCopy}>
          <p>Return channel · {object.object}</p>
          <h2>Rewinding to My Room…</h2>
          <span>{object.label} stays selected while the room signal returns.</span>
        </div>
        <div aria-hidden="true" className={styles.returnSignalTrack}>
          <i />
        </div>
      </div>
    </section>
  );
}

function SimulationRevealSignal({
  onCancel,
  reducedMotion,
}: {
  onCancel: () => void;
  reducedMotion: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      cancelRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    cancelRef.current?.focus({ preventScroll: true });
  };

  return (
    <section
      aria-label="Revealing the Anish simulation"
      aria-modal="true"
      className={styles.simulationReveal}
      data-reduced-motion={reducedMotion || undefined}
      data-simulation-reveal-overlay
      onKeyDown={containFocus}
      role="dialog"
    >
      <div aria-hidden="true" className={styles.simulationField}>
        <div className={styles.memoryWafer} data-simulation-memory-wafer>
          <i />
          <i />
          <i />
          <i />
          <span>ROOM / MEMORY</span>
        </div>
        <div className={styles.simulationRobot} data-simulation-robot>
          <i className={styles.robotAntenna} />
          <div className={styles.robotHead}>
            <i />
            <i />
            <span />
          </div>
          <div className={styles.robotBody}>
            <b>ME</b>
            <span>SIM</span>
          </div>
        </div>
      </div>
      <div className={styles.simulationCopy}>
        <p>{SITE_COPY.simulation["transition-eyebrow"]}</p>
        <h2>{SITE_COPY.simulation["transition-title"]}</h2>
        <span role="status">{SITE_COPY.simulation["transition-summary"]}</span>
        <button onClick={onCancel} ref={cancelRef} type="button">
          {SITE_COPY.simulation["transition-cancel-cta"]}
        </button>
      </div>
    </section>
  );
}

function routeObject(pathname: string): RoomObjectId | null {
  if (/^\/play\/travel\/trips\/[^/]+\/?$/.test(pathname)) return "travel";
  const match = /^\/play\/([^/]+)\/?$/.exec(pathname);
  return match && isRoomObjectId(match[1]) ? match[1] : null;
}

function historyRoomObject(): RoomObjectId | null {
  const value = window.history.state?.[ROOM_HISTORY_ORIGIN_KEY];
  return typeof value === "string" && isRoomObjectId(value) ? value : null;
}

function historyRoomDepth(): number | null {
  const value = window.history.state?.[ROOM_HISTORY_DEPTH_KEY];
  return Number.isInteger(value) && value > 0 ? value : null;
}

function historyRoomPath(): string | null {
  const value = window.history.state?.[ROOM_HISTORY_PATH_KEY];
  return typeof value === "string" ? value : null;
}

function markRoomHistoryEntry(id: RoomObjectId, depth = 1) {
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
  window.history.replaceState(
    {
      ...currentState,
      [ROOM_HISTORY_ORIGIN_KEY]: id,
      [ROOM_HISTORY_DEPTH_KEY]: depth,
      [ROOM_HISTORY_PATH_KEY]: window.location.pathname,
    },
    "",
    window.location.href,
  );
}

function clearRoomHistoryEntry() {
  const currentState = window.history.state;
  if (!currentState || typeof currentState !== "object") return;
  if (!(ROOM_HISTORY_ORIGIN_KEY in currentState)) return;
  const nextState = { ...currentState };
  delete nextState[ROOM_HISTORY_ORIGIN_KEY];
  delete nextState[ROOM_HISTORY_DEPTH_KEY];
  delete nextState[ROOM_HISTORY_PATH_KEY];
  window.history.replaceState(nextState, "", window.location.href);
}

export function RoomExperienceProvider({
  children,
  simulationEnabled,
  travelEnabled = false,
}: {
  children: ReactNode;
  simulationEnabled: boolean;
  travelEnabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { playCue } = useExperienceAudio();
  const objectRouteActive = routeObject(pathname) !== null;
  const [state, dispatch] = useReducer(roomExperienceReducer, INITIAL_ROOM_STATE);
  const [statusMessage, setStatusMessage] = useState("");
  const [simulationTransitioning, setSimulationTransitioning] = useState(false);
  const [simulationReducedMotion, setSimulationReducedMotion] = useState(false);
  const transitionEpoch = useRef(0);
  const transitionAnimations = useRef<Array<ReturnType<typeof animate>>>([]);
  const transitionFrame = useRef<number | null>(null);
  const lastInvoker = useRef<RoomObjectId | null>(null);
  const pendingFocus = useRef<RoomObjectId | null>(null);
  const pendingRoomNavigation = useRef<RoomObjectId | null>(null);
  const activeObjectRouteOrigin = useRef<ObjectRouteOrigin | null>(null);
  const activeObjectRouteDepth = useRef(0);
  const previousRouteObject = useRef<RoomObjectId | null>(routeObject(pathname));
  const focusRequestEpoch = useRef(0);
  const focusRequestCleanup = useRef<() => void>(() => undefined);
  const announcementEpoch = useRef(0);
  const roomEntered = useRef(state.entered);
  const enabledObjectIds = useMemo<readonly RoomObjectId[]>(
    () =>
      travelEnabled
        ? Object.keys(ROOM_OBJECT_BY_ID) as RoomObjectId[]
        : (Object.keys(ROOM_OBJECT_BY_ID) as RoomObjectId[]).filter(
            (id) => id !== "travel",
          ),
    [travelEnabled],
  );

  const announce = useCallback((message: string) => {
    const epoch = ++announcementEpoch.current;
    requestAnimationFrame(() => {
      if (epoch === announcementEpoch.current) setStatusMessage(message);
    });
  }, []);

  const focusAfterPaint = useCallback((selectors: string | string[]) => {
    focusRequestCleanup.current();
    const requestEpoch = ++focusRequestEpoch.current;
    const candidates = Array.isArray(selectors) ? selectors : [selectors];
    let attempts = 0;
    let stableFrames = 0;
    let frame: number | null = null;
    let cancelled = false;

    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("keydown", cancelForUserInput, true);
      window.removeEventListener("pointerdown", cancelForUserInput, true);
      if (focusRequestCleanup.current === cleanup) {
        focusRequestCleanup.current = () => undefined;
      }
    };

    const cancelForUserInput = () => cleanup();
    focusRequestCleanup.current = cleanup;
    window.addEventListener("keydown", cancelForUserInput, true);
    window.addEventListener("pointerdown", cancelForUserInput, true);

    const focusAvailableTarget = () => {
      frame = null;
      if (cancelled || requestEpoch !== focusRequestEpoch.current) {
        cleanup();
        return;
      }
      for (const selector of candidates) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || element.closest("[inert]")) continue;
        if (document.activeElement !== element) {
          element.focus({ preventScroll: true });
        }
        stableFrames = document.activeElement === element ? stableFrames + 1 : 0;
        attempts += 1;
        if (stableFrames < 12 && attempts < 180) {
          frame = requestAnimationFrame(focusAvailableTarget);
        } else {
          cleanup();
        }
        return;
      }
      stableFrames = 0;
      attempts += 1;
      if (attempts < 180) frame = requestAnimationFrame(focusAvailableTarget);
      else cleanup();
    };

    frame = requestAnimationFrame(focusAvailableTarget);
  }, []);

  useEffect(
    () => () => {
      focusRequestCleanup.current();
    },
    [],
  );

  useEffect(() => {
    if (sessionRoomFailure) {
      dispatch({ type: "fallback", reason: sessionRoomFailure });
    }
  }, []);

  useEffect(() => {
    roomEntered.current = state.entered;
  }, [state.entered]);

  const resetTransitionVisuals = useCallback(() => {
    for (const selector of [
      "[data-room-runtime]",
      "[data-room-stage-shell]",
      "[data-room-screen]",
      "[data-room-object-control]",
      "[data-room-static-stage]",
    ]) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        element.style.removeProperty("opacity");
        element.style.removeProperty("transform");
      }
    }
  }, []);

  const finishTransitionVisuals = useCallback(() => {
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    for (const animation of transitionAnimations.current) animation.cancel();
    transitionAnimations.current = [];
    resetTransitionVisuals();
  }, [resetTransitionVisuals]);

  const cancelTransition = useCallback(() => {
    transitionEpoch.current += 1;
    finishTransitionVisuals();
  }, [finishTransitionVisuals]);

  const trackAnimation = useCallback(
    (animation: ReturnType<typeof animate>) => {
      transitionAnimations.current.push(animation);
      return animation;
    },
    [],
  );

  const guaranteeTransitionCompletion = useCallback(
    (duration: number, epoch: number, complete: () => void) => {
      const startedAt = performance.now();
      const check = (now: number) => {
        if (epoch !== transitionEpoch.current) return;
        if (now - startedAt >= duration) {
          transitionFrame.current = null;
          complete();
          return;
        }
        transitionFrame.current = requestAnimationFrame(check);
      };
      transitionFrame.current = requestAnimationFrame(check);
    },
    [],
  );

  useEffect(() => {
    finishTransitionVisuals();
    const activeRouteObject = routeObject(pathname);
    const intendedRouteObject = pendingRoomNavigation.current;

    // A completed router transition cannot be cancelled. If an older object
    // route commits after a newer room selection, replace that stale entry
    // with the latest intent before it can clear the pending room navigation.
    if (
      activeRouteObject &&
      intendedRouteObject &&
      activeRouteObject !== intendedRouteObject
    ) {
      router.replace(
        routeWithPreviewFixture(
          `/play/${intendedRouteObject}`,
          previewFixtureFromSearch(window.location.search),
        ),
        { scroll: false },
      );
      return;
    }
    const priorRouteObject = previousRouteObject.current;
    previousRouteObject.current = activeRouteObject;
    dispatch({ type: "route", id: activeRouteObject });

    if (activeRouteObject) {
      const pendingRoomEntry =
        pendingRoomNavigation.current === activeRouteObject;
      const continuingRoomObject =
        priorRouteObject === activeRouteObject &&
        activeObjectRouteOrigin.current === "room";
      const enteredFromRoom =
        pendingRoomEntry ||
        continuingRoomObject ||
        (roomEntered.current && historyRoomObject() === activeRouteObject);
      if (enteredFromRoom) {
        const storedDepth = historyRoomDepth();
        const storedPathMatches = historyRoomPath() === pathname;
        const depth = pendingRoomEntry
          ? 1
          : storedPathMatches && storedDepth
            ? storedDepth
            : Math.max(1, activeObjectRouteDepth.current + 1);
        activeObjectRouteDepth.current = depth;
        if (pendingRoomEntry || !storedPathMatches) {
          markRoomHistoryEntry(activeRouteObject, depth);
        }
      } else {
        activeObjectRouteDepth.current = 0;
        clearRoomHistoryEntry();
      }
      activeObjectRouteOrigin.current = enteredFromRoom ? "room" : "direct";
      pendingRoomNavigation.current = null;
      const object = ROOM_OBJECT_BY_ID[activeRouteObject];
      announce(`Opened ${object.label}: ${object.title}.`);
      if (enteredFromRoom) focusAfterPaint("[data-room-screen-entry-focus]");
      return;
    }

    activeObjectRouteOrigin.current = null;
    activeObjectRouteDepth.current = 0;
    if (pathname === "/play" || pathname === "/play/") {
      const target = pendingFocus.current ?? lastInvoker.current;
      if (!target) return;
      pendingFocus.current = null;
      const object = ROOM_OBJECT_BY_ID[target];
      announce(`Returned to the room. ${object.label} is selected.`);
      focusAfterPaint(
        roomEntered.current
          ? [
              `[data-room-object-control="${target}"]`,
              `[data-room-overview] [data-room-object-link="${target}"]`,
            ]
          : `[data-room-overview] [data-room-object-link="${target}"]`,
      );
      return;
    }

    if (priorRouteObject) pendingFocus.current = null;
  }, [announce, finishTransitionVisuals, focusAfterPaint, pathname, router]);

  useEffect(() => {
    const roomIsForeground =
      state.entered &&
      !state.fallbackReason &&
      (pathname === "/play" || pathname === "/play/");
    if (!roomIsForeground) return;

    const obscured = document.querySelectorAll<HTMLElement>(
      "[data-room-overview], body > .skip-link, body > header, body > .site-frame > footer",
    );
    const previousAttributes = [...obscured].map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    const previousOverflow = document.documentElement.style.overflow;
    for (const element of obscured) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of previousAttributes) {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [pathname, state.entered, state.fallbackReason]);

  useEffect(() => {
    if (!simulationTransitioning) return;
    const obscured = document.querySelectorAll<HTMLElement>(
      "[data-room-overview], body > .skip-link, body > header, body > .site-frame > footer",
    );
    const previousAttributes = [...obscured].map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    const previousOverflow = document.documentElement.style.overflow;
    for (const element of obscured) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of previousAttributes) {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [simulationTransitioning]);

  useEffect(() => cancelTransition, [cancelTransition]);

  const selectObject = useCallback(
    (id: RoomObjectId) => {
      cancelTransition();
      if (sessionRoomFailure) return;
      const epoch = transitionEpoch.current;
      lastInvoker.current = id;
      pendingRoomNavigation.current = id;
      const object = ROOM_OBJECT_BY_ID[id];
      playCue("interface-confirm");
      announce(
        `Selected ${object.label}. Moving toward the ${object.object.toLowerCase()}.`,
      );
      dispatch({ type: "select", id });
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      let navigated = false;
      const navigate = () => {
        if (epoch !== transitionEpoch.current || navigated) return;
        navigated = true;
        dispatch({ type: "phase", phase: "navigating", epoch });
        router.push(
          routeWithPreviewFixture(
            `/play/${id}`,
            previewFixtureFromSearch(window.location.search),
          ),
          { scroll: false },
        );
      };
      if (reduced) {
        navigate();
        return;
      }

      const transitionSurface = document.querySelector<HTMLElement>(
        "[data-room-stage-shell]",
      );
      const control = document.querySelector<HTMLElement>(
        `[data-room-object-control="${id}"]`,
      );
      if (!transitionSurface) {
        navigate();
        return;
      }

      const matchCut = () => {
        if (epoch !== transitionEpoch.current) return;
        dispatch({ type: "phase", phase: "navigating", epoch });
        trackAnimation(
          animate(transitionSurface, {
            opacity: [0.94, 0],
            duration: 180,
            ease: "in(3)",
            onComplete: navigate,
          }),
        );
      };
      const approach = () => {
        if (epoch !== transitionEpoch.current) return;
        dispatch({ type: "phase", phase: "approaching", epoch });
        trackAnimation(
          animate(transitionSurface, {
            opacity: [1, 0.94],
            duration: 260,
            ease: "inOut(3)",
            onComplete: matchCut,
          }),
        );
      };

      trackAnimation(
        animate(control ?? transitionSurface, {
          scale: control ? [1, 1.035, 1] : [1, 1.004, 1],
          duration: 140,
          ease: "out(3)",
          onComplete: approach,
        }),
      );
      guaranteeTransitionCompletion(620, epoch, navigate);
    },
    [
      announce,
      cancelTransition,
      guaranteeTransitionCompletion,
      playCue,
      router,
      trackAnimation,
    ],
  );

  const returnToRoom = useCallback(() => {
    cancelTransition();
    const epoch = transitionEpoch.current;
    const activeRouteObject = routeObject(pathname);
    const target = activeRouteObject ?? lastInvoker.current ?? state.focusedId;
    if (target) pendingFocus.current = target;
    const returnWithBrowserHistory = activeObjectRouteOrigin.current === "room";
    const roomHistoryDepth = activeObjectRouteDepth.current;
    announce(
      target
        ? `Rewinding to My Room. ${ROOM_OBJECT_BY_ID[target].label} will remain selected.`
        : "Rewinding to My Room.",
    );
    playCue("interface-return");
    dispatch({ type: "return" });
    let navigated = false;
    const navigate = () => {
      if (epoch !== transitionEpoch.current || navigated) return;
      navigated = true;
      if (returnWithBrowserHistory && roomHistoryDepth > 1) {
        window.history.go(-roomHistoryDepth);
      } else if (returnWithBrowserHistory) router.back();
      else {
        router.push(
          routeWithPreviewFixture(
            "/play",
            previewFixtureFromSearch(window.location.search),
          ),
          { scroll: false },
        );
      }
    };
    focusAfterPaint("[data-room-return-status]");
    requestAnimationFrame(navigate);
  }, [
    announce,
    cancelTransition,
    focusAfterPaint,
    pathname,
    playCue,
    router,
    state.focusedId,
  ]);

  const setFallback = useCallback(
    (reason: string) => {
      sessionRoomFailure = reason;
      cancelTransition();
      dispatch({ type: "fallback", reason });
      announce(
        `The interactive room is unavailable. The ${enabledObjectIds.length} object links remain available.`,
      );
      const target = lastInvoker.current ?? state.focusedId ?? "watch";
      focusAfterPaint(
        `[data-room-overview] [data-room-object-link="${target}"]`,
      );
    },
    [announce, cancelTransition, enabledObjectIds.length, focusAfterPaint, state.focusedId],
  );

  const notifyRuntimeMounted = useCallback(() => {
    announce("Interactive room opened.");
    focusAfterPaint("[data-room-runtime-entry-focus]");
  }, [announce, focusAfterPaint]);

  const enterRoom = useCallback(() => {
    if (sessionRoomFailure) return;
    playCue("room-enter");
    announce("Opening the interactive room.");
    dispatch({ type: "enter" });
  }, [announce, playCue]);

  const cancelSimulationReveal = useCallback(() => {
    if (!simulationTransitioning) return;
    cancelTransition();
    setSimulationTransitioning(false);
    announce("Simulation reveal cancelled. The room is ready.");
    focusAfterPaint([
      "[data-room-runtime] [data-reveal-simulation]",
      "[data-room-overview] [data-reveal-simulation]",
    ]);
  }, [
    announce,
    cancelTransition,
    focusAfterPaint,
    simulationTransitioning,
  ]);

  const revealSimulation = useCallback(() => {
    if (!simulationEnabled || simulationTransitioning) return;
    cancelTransition();
    const epoch = transitionEpoch.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSimulationReducedMotion(reduced);
    setSimulationTransitioning(true);
    announce(
      "Revealing the Anish simulation. Compressing the room into a memory wafer.",
    );
    playCue("simulation-reveal");
    router.prefetch("/simulation");

    let navigated = false;
    const navigate = () => {
      if (epoch !== transitionEpoch.current || navigated) return;
      navigated = true;
      router.push("/simulation", { scroll: false });
    };

    requestAnimationFrame(() => {
      if (epoch !== transitionEpoch.current) return;
      if (reduced) {
        guaranteeTransitionCompletion(240, epoch, navigate);
        return;
      }
      const surface = document.querySelector<HTMLElement>(
        state.entered
          ? "[data-room-stage-shell]"
          : "[data-room-static-stage]",
      );
      const overlay = document.querySelector<HTMLElement>(
        "[data-simulation-reveal-overlay]",
      );
      const robot = document.querySelector<HTMLElement>(
        "[data-simulation-robot]",
      );
      const wafer = document.querySelector<HTMLElement>(
        "[data-simulation-memory-wafer]",
      );
      if (!surface || !overlay || !robot || !wafer) {
        navigate();
        return;
      }

      trackAnimation(
        animate(overlay, {
          opacity: [0, 1],
          duration: 180,
          ease: "out(3)",
        }),
      );
      trackAnimation(
        animate(robot, {
          scale: [0.72, 1],
          translateY: [36, 0],
          duration: 440,
          ease: "out(4)",
        }),
      );
      trackAnimation(
        animate(surface, {
          scaleX: [1, 0.76, 0.18],
          scaleY: [1, 1.08, 0.045],
          rotate: [0, -2, 7],
          translateY: [0, -12, 42],
          opacity: [1, 0.96, 0],
          duration: 760,
          ease: "inOut(4)",
        }),
      );
      trackAnimation(
        animate(wafer, {
          opacity: [0, 1, 1, 0],
          scale: [0.2, 1.08, 0.72, 0.12],
          translateX: [-90, -22, 48, 112],
          duration: 880,
          ease: "inOut(3)",
        }),
      );
      guaranteeTransitionCompletion(940, epoch, navigate);
    });
  }, [
    announce,
    cancelTransition,
    guaranteeTransitionCompletion,
    playCue,
    router,
    simulationEnabled,
    simulationTransitioning,
    state.entered,
    trackAnimation,
  ]);

  const focusObject = useCallback((id: RoomObjectId | null) => {
    dispatch({ type: "focus", id });
  }, []);

  const resetView = useCallback(() => {
    dispatch({ type: "reset-view" });
  }, []);

  const rotate = useCallback((rotation: RoomRotation) => {
    dispatch({ type: "rotate", rotation });
  }, []);

  const exitRoom = useCallback(() => {
    cancelTransition();
    dispatch({ type: "exit" });
    announce("Interactive room closed.");
    focusAfterPaint("[data-room-enter-control]");
  }, [announce, cancelTransition, focusAfterPaint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (simulationTransitioning) {
        event.preventDefault();
        cancelSimulationReveal();
        return;
      }
      if (routeObject(pathname)) {
        event.preventDefault();
        returnToRoom();
      } else if (state.entered) {
        event.preventDefault();
        exitRoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cancelSimulationReveal,
    exitRoom,
    pathname,
    returnToRoom,
    simulationTransitioning,
    state.entered,
  ]);

  const value = useMemo<RoomExperienceContextValue>(
    () => ({
      ...state,
      cancelSimulationReveal,
      enterRoom,
      exitRoom,
      focusObject,
      notifyRuntimeMounted,
      objectRouteActive,
      enabledObjectIds,
      revealSimulation,
      resetView,
      returnToRoom,
      rotate,
      setFallback,
      selectObject,
      simulationEnabled,
      simulationTransitioning,
      statusMessage,
    }),
    [
      cancelSimulationReveal,
      enterRoom,
      exitRoom,
      focusObject,
      notifyRuntimeMounted,
      objectRouteActive,
      enabledObjectIds,
      revealSimulation,
      resetView,
      returnToRoom,
      rotate,
      selectObject,
      simulationEnabled,
      simulationTransitioning,
      setFallback,
      state,
      statusMessage,
    ],
  );

  return (
    <RoomExperienceContext.Provider value={value}>
      <p
        aria-atomic="true"
        aria-live={
          state.entered && (pathname === "/play" || pathname === "/play/")
            ? "off"
            : "polite"
        }
        className={styles.announcer}
        data-room-announcer
        role="status"
      >
        {statusMessage}
      </p>
      {state.entered ? (
        <LazyRoomBoundary
          onFailure={() => setFallback("room-runtime-chunk-failed")}
        >
          <Suspense fallback={<LazyRoomFallback onLeave={exitRoom} />}>
            <LazyRoomRuntime />
          </Suspense>
        </LazyRoomBoundary>
      ) : null}
      {state.phase === "returning" && objectRouteActive ? (
        <ReturnSignal
          objectId={routeObject(pathname) ?? state.focusedId ?? "watch"}
        />
      ) : null}
      {simulationTransitioning ? (
        <SimulationRevealSignal
          onCancel={cancelSimulationReveal}
          reducedMotion={simulationReducedMotion}
        />
      ) : null}
      {children}
    </RoomExperienceContext.Provider>
  );
}

export function useRoomExperience(): RoomExperienceContextValue {
  const value = useContext(RoomExperienceContext);
  if (!value) {
    throw new Error("Room controls must be rendered inside RoomExperienceProvider.");
  }
  return value;
}
