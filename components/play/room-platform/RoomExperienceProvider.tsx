"use client";

import { animate } from "animejs";
import { usePathname, useRouter } from "next/navigation";
import {
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
  statusMessage: string;
};

type ObjectRouteOrigin = "direct" | "room";

const ROOM_HISTORY_ORIGIN_KEY = "__anishRoomOrigin";

const RoomExperienceContext = createContext<RoomExperienceContextValue | null>(
  null,
);

const LazyRoomRuntime = lazy(() =>
  import("./RoomRuntime").then((module) => ({ default: module.RoomRuntime })),
);

let sessionRoomFailure: string | null = null;

function routeObject(pathname: string): RoomObjectId | null {
  const match = /^\/play\/([^/]+)\/?$/.exec(pathname);
  return match && isRoomObjectId(match[1]) ? match[1] : null;
}

function historyRoomObject(): RoomObjectId | null {
  const value = window.history.state?.[ROOM_HISTORY_ORIGIN_KEY];
  return typeof value === "string" && isRoomObjectId(value) ? value : null;
}

function markRoomHistoryEntry(id: RoomObjectId) {
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
  window.history.replaceState(
    { ...currentState, [ROOM_HISTORY_ORIGIN_KEY]: id },
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
  window.history.replaceState(nextState, "", window.location.href);
}

export function RoomExperienceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const objectRouteActive = routeObject(pathname) !== null;
  const [state, dispatch] = useReducer(roomExperienceReducer, INITIAL_ROOM_STATE);
  const [statusMessage, setStatusMessage] = useState("");
  const transitionEpoch = useRef(0);
  const transitionAnimations = useRef<Array<ReturnType<typeof animate>>>([]);
  const transitionFrame = useRef<number | null>(null);
  const lastInvoker = useRef<RoomObjectId | null>(null);
  const pendingFocus = useRef<RoomObjectId | null>(null);
  const pendingRoomNavigation = useRef<RoomObjectId | null>(null);
  const activeObjectRouteOrigin = useRef<ObjectRouteOrigin | null>(null);
  const previousRouteObject = useRef<RoomObjectId | null>(routeObject(pathname));
  const focusRequestEpoch = useRef(0);
  const announcementEpoch = useRef(0);
  const roomEntered = useRef(state.entered);

  const announce = useCallback((message: string) => {
    const epoch = ++announcementEpoch.current;
    requestAnimationFrame(() => {
      if (epoch === announcementEpoch.current) setStatusMessage(message);
    });
  }, []);

  const focusAfterPaint = useCallback((selectors: string | string[]) => {
    const requestEpoch = ++focusRequestEpoch.current;
    const candidates = Array.isArray(selectors) ? selectors : [selectors];
    let attempts = 0;

    const focusAvailableTarget = () => {
      if (requestEpoch !== focusRequestEpoch.current) return;
      for (const selector of candidates) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || element.closest("[inert]")) continue;
        element.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < 12) requestAnimationFrame(focusAvailableTarget);
    };

    requestAnimationFrame(focusAvailableTarget);
  }, []);

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
      "[data-room-screen]",
      "[data-room-object-control]",
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
    const priorRouteObject = previousRouteObject.current;
    const priorRouteOrigin = activeObjectRouteOrigin.current;
    previousRouteObject.current = activeRouteObject;
    dispatch({ type: "route", id: activeRouteObject });

    if (activeRouteObject) {
      const pendingRoomEntry =
        pendingRoomNavigation.current === activeRouteObject;
      const enteredFromRoom =
        pendingRoomEntry ||
        (roomEntered.current && historyRoomObject() === activeRouteObject);
      if (pendingRoomEntry) markRoomHistoryEntry(activeRouteObject);
      else if (!enteredFromRoom) clearRoomHistoryEntry();
      activeObjectRouteOrigin.current = enteredFromRoom ? "room" : "direct";
      pendingRoomNavigation.current = null;
      const object = ROOM_OBJECT_BY_ID[activeRouteObject];
      announce(`Opened ${object.label}: ${object.title}.`);
      if (enteredFromRoom) focusAfterPaint("[data-room-screen]");
      return;
    }

    activeObjectRouteOrigin.current = null;
    if (pathname === "/play" || pathname === "/play/") {
      const target = pendingFocus.current ?? lastInvoker.current;
      if (!target) return;
      pendingFocus.current = null;
      const object = ROOM_OBJECT_BY_ID[target];
      announce(`Returned to the room. ${object.label} is selected.`);
      focusAfterPaint(
        priorRouteOrigin === "room"
          ? [
              `[data-room-object-control="${target}"]`,
              `[data-room-overview] [data-room-object-link="${target}"]`,
            ]
          : `[data-room-overview] [data-room-object-link="${target}"]`,
      );
      return;
    }

    if (priorRouteObject) pendingFocus.current = null;
  }, [announce, finishTransitionVisuals, focusAfterPaint, pathname]);

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

  useEffect(() => cancelTransition, [cancelTransition]);

  const selectObject = useCallback(
    (id: RoomObjectId) => {
      cancelTransition();
      if (sessionRoomFailure) return;
      const epoch = transitionEpoch.current;
      lastInvoker.current = id;
      pendingRoomNavigation.current = id;
      const object = ROOM_OBJECT_BY_ID[id];
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
        router.push(`/play/${id}`, { scroll: false });
      };
      if (reduced) {
        navigate();
        return;
      }

      const runtime = document.querySelector<HTMLElement>(
        "[data-room-runtime]",
      );
      const control = document.querySelector<HTMLElement>(
        `[data-room-object-control="${id}"]`,
      );
      if (!runtime) {
        navigate();
        return;
      }

      const matchCut = () => {
        if (epoch !== transitionEpoch.current) return;
        dispatch({ type: "phase", phase: "navigating", epoch });
        trackAnimation(
          animate(runtime, {
            opacity: [0.94, 0],
            scale: [1.012, 1.025],
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
          animate(runtime, {
            opacity: [1, 0.94],
            scale: [1, 1.012],
            duration: 260,
            ease: "inOut(3)",
            onComplete: matchCut,
          }),
        );
      };

      trackAnimation(
        animate(control ?? runtime, {
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
    dispatch({ type: "return" });
    let navigated = false;
    const navigate = () => {
      if (epoch !== transitionEpoch.current || navigated) return;
      navigated = true;
      if (returnWithBrowserHistory) router.back();
      else router.push("/play", { scroll: false });
    };
    const screen = document.querySelector<HTMLElement>("[data-room-screen]");
    if (
      !screen ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      navigate();
      return;
    }
    trackAnimation(
      animate(screen, {
        opacity: [1, 0.76],
        translateY: [0, 8],
        duration: 180,
        ease: "in(3)",
        onComplete: navigate,
      }),
    );
    guaranteeTransitionCompletion(220, epoch, navigate);
  }, [
    cancelTransition,
    guaranteeTransitionCompletion,
    pathname,
    router,
    state.focusedId,
    trackAnimation,
  ]);

  const setFallback = useCallback(
    (reason: string) => {
      sessionRoomFailure = reason;
      cancelTransition();
      dispatch({ type: "fallback", reason });
      announce(
        "The interactive room is unavailable. The six collection links remain available.",
      );
    },
    [announce, cancelTransition],
  );

  const notifyRuntimeMounted = useCallback(() => {
    announce("Interactive room opened.");
    focusAfterPaint("[data-room-runtime-entry-focus]");
  }, [announce, focusAfterPaint]);

  const enterRoom = useCallback(() => {
    if (sessionRoomFailure) return;
    announce("Opening the interactive room.");
    dispatch({ type: "enter" });
  }, [announce]);

  const exitRoom = useCallback(() => {
    cancelTransition();
    dispatch({ type: "exit" });
    announce("Interactive room closed.");
    focusAfterPaint("[data-room-enter-control]");
  }, [announce, cancelTransition, focusAfterPaint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
  }, [exitRoom, pathname, returnToRoom, state.entered]);

  const value = useMemo<RoomExperienceContextValue>(
    () => ({
      ...state,
      enterRoom,
      exitRoom,
      focusObject: (id) => dispatch({ type: "focus", id }),
      notifyRuntimeMounted,
      objectRouteActive,
      resetView: () => dispatch({ type: "reset-view" }),
      returnToRoom,
      rotate: (rotation) => dispatch({ type: "rotate", rotation }),
      setFallback,
      selectObject,
      statusMessage,
    }),
    [
      enterRoom,
      exitRoom,
      notifyRuntimeMounted,
      objectRouteActive,
      returnToRoom,
      selectObject,
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
        <Suspense fallback={null}>
          <LazyRoomRuntime />
        </Suspense>
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
