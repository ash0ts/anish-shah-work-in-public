"use client";

import { animate } from "animejs";
import { usePathname, useRouter } from "next/navigation";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
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
import {
  ROOM_OBJECT_BY_ID,
  ROOM_OBJECTS,
} from "./room-registry";
import {
  previewFixtureFromSearch,
  routeWithPreviewFixture,
} from "./preview-fixture-navigation";
import {
  INITIAL_ROOM_STATE,
  roomExperienceReducer,
} from "./room-reducer";
import styles from "./RoomExperienceProvider.module.css";
import { roomDirectoryHref } from "./room-entry-policy";
import { useRoomFocus } from "./useRoomFocus";
import { useRoomTransitions } from "./useRoomTransitions";
import { routeObject, historyRoomObject, historyRoomDepth, historyRoomPath, markRoomHistoryEntry, clearRoomHistoryEntry } from "./room-history";
import type {
  RoomExperienceState,
  RoomObjectId,
  RoomRotation,
} from "./room-types";

type RoomExperienceContextValue = RoomExperienceState & {
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
  simulationEnabled: boolean;
  statusMessage: string;
};

type ObjectRouteOrigin = "direct" | "room";

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
  const [runtimeMounted, setRuntimeMounted] = useState(false);
  const { transitionEpoch, finishTransitionVisuals, cancelTransition, trackAnimation, guaranteeTransitionCompletion } = useRoomTransitions();
  const lastInvoker = useRef<RoomObjectId | null>(null);
  const pendingFocus = useRef<RoomObjectId | null>(null);
  const pendingRoomNavigation = useRef<RoomObjectId | null>(null);
  const activeObjectRouteOrigin = useRef<ObjectRouteOrigin | null>(null);
  const activeObjectRouteDepth = useRef(0);
  const previousRouteObject = useRef<RoomObjectId | null>(routeObject(pathname));
  const announcementEpoch = useRef(0);
  const roomEntered = useRef(state.entered);
  const enabledObjectIds = useMemo<readonly RoomObjectId[]>(
    () =>
      travelEnabled
        ? ROOM_OBJECTS.map(({ id }) => id)
        : ROOM_OBJECTS.filter(({ id }) => id !== "travel").map(({ id }) => id),
    [travelEnabled],
  );

  const announce = useCallback((message: string) => {
    const epoch = ++announcementEpoch.current;
    requestAnimationFrame(() => {
      if (epoch === announcementEpoch.current) setStatusMessage(message);
    });
  }, []);

  const focusAfterPaint = useRoomFocus();

  useEffect(() => {
    if (sessionRoomFailure) {
      dispatch({ type: "fallback", reason: sessionRoomFailure });
    }
  }, []);

  useEffect(() => {
    roomEntered.current = state.entered;
  }, [state.entered]);

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
      state.entered && runtimeMounted &&
      !state.fallbackReason &&
      (pathname === "/play" || pathname === "/play/");
    if (!roomIsForeground) return;

    const obscured = document.querySelectorAll<HTMLElement>(
      "[data-room-overview], body > .site-frame > footer",
    );
    const previousAttributes = [...obscured].map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    const previousOverflow = document.documentElement.style.overflow;
    const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
    const previousSkipHref = skipLink?.getAttribute("href");
    skipLink?.setAttribute("href", "#room-main");
    for (const element of obscured) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (previousSkipHref) skipLink?.setAttribute("href", previousSkipHref);
      for (const { element, inert, ariaHidden } of previousAttributes) {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [pathname, runtimeMounted, state.entered, state.fallbackReason]);

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
      announce(`Opening the ${object.object.toLowerCase()}: ${object.label}.`);
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
      transitionEpoch,
    ],
  );

  const returnToRoom = useCallback(() => {
    cancelTransition();
    const epoch = transitionEpoch.current;
    const activeRouteObject = routeObject(pathname);
    const target = activeRouteObject ?? lastInvoker.current ?? state.focusedId;
    if (target) { pendingFocus.current = target; lastInvoker.current = target; }
    const returnWithBrowserHistory = activeObjectRouteOrigin.current === "room";
    const roomHistoryDepth = activeObjectRouteDepth.current;
    announce(
      target
        ? `Returning to the room. ${ROOM_OBJECT_BY_ID[target].label} remains selected.`
        : "Returning to the room.",
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
    requestAnimationFrame(navigate);
  }, [
    announce,
    cancelTransition,
    pathname,
    playCue,
    router,
    state.focusedId,
    transitionEpoch,
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
    setRuntimeMounted(true);
    announce("Interactive room opened.");
    focusAfterPaint(lastInvoker.current
      ? `[data-room-object-control="${lastInvoker.current}"]`
      : "[data-room-runtime-entry-focus]");
  }, [announce, focusAfterPaint]);

  const enterRoom = useCallback(() => {
    if (sessionRoomFailure) return;
    playCue("room-enter");
    announce("Opening the interactive room.");
    dispatch({ type: "enter" });
  }, [announce, playCue]);

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
    setRuntimeMounted(false);
    dispatch({ type: "exit" });
    announce("Interactive room closed.");
    router.replace(roomDirectoryHref(window.location.search), { scroll: false });
    focusAfterPaint('[data-room-overview] [data-room-object-link="watch"]');
  }, [announce, cancelTransition, focusAfterPaint, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A nested dialog owns its Escape before the room's window listener.
      // Closing both would unmount its return-focus target.
      if (event.defaultPrevented || event.key !== "Escape") return;
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
    exitRoom,
    pathname,
    returnToRoom,
    state.entered,
  ]);

  const value = useMemo<RoomExperienceContextValue>(
    () => ({
      ...state,
      enterRoom,
      exitRoom,
      focusObject,
      notifyRuntimeMounted,
      objectRouteActive,
      enabledObjectIds,
      resetView,
      returnToRoom,
      rotate,
      setFallback,
      selectObject,
      simulationEnabled,
      statusMessage,
    }),
    [
      enterRoom,
      exitRoom,
      focusObject,
      notifyRuntimeMounted,
      objectRouteActive,
      enabledObjectIds,
      resetView,
      returnToRoom,
      rotate,
      selectObject,
      simulationEnabled,
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
          <Suspense fallback={null}>
            <LazyRoomRuntime />
          </Suspense>
        </LazyRoomBoundary>
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
