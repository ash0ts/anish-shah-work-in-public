"use client";

import { animate } from "animejs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import styles from "./SiteHeader.module.css";

type NavigationKey = "work" | "play";

type PrimaryNavigationItem = readonly [
  label: string,
  href: `/${NavigationKey}`,
];

type IndicatorMotion = {
  opacity: number;
  width: number;
  x: number;
};

function navigationKeyForPath(pathname: string): NavigationKey | null {
  if (pathname === "/work" || pathname.startsWith("/work/")) return "work";
  if (
    pathname === "/play" ||
    pathname.startsWith("/play/") ||
    pathname === "/simulation" ||
    pathname.startsWith("/simulation/")
  ) {
    return "play";
  }
  return null;
}

export function PrimaryNavigation({
  items,
}: {
  items: readonly PrimaryNavigationItem[];
}) {
  const pathname = usePathname();
  const activeKey = navigationKeyForPath(pathname);
  const activeKeyRef = useRef(activeKey);
  const initializedRef = useRef(false);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorCoreRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef<Partial<Record<NavigationKey, HTMLAnchorElement>>>({});
  const motionRef = useRef<ReturnType<typeof animate> | null>(null);
  const shapeMotionRef = useRef<ReturnType<typeof animate> | null>(null);
  const motionState = useRef<IndicatorMotion>({ opacity: 0, width: 0, x: 0 });
  const navigationRef = useRef<HTMLElement>(null);
  const optimisticResetRef = useRef<number | null>(null);

  const renderIndicator = useCallback(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const { opacity, width, x } = motionState.current;
    indicator.style.opacity = String(opacity);
    indicator.style.transform = `translate3d(${x}px, 0, 0)`;
    indicator.style.width = `${width}px`;
  }, []);

  const positionIndicator = useCallback(
    (withMotion: boolean, keyOverride?: NavigationKey | null) => {
      const navigation = navigationRef.current;
      const indicator = indicatorRef.current;
      const key =
        keyOverride === undefined ? activeKeyRef.current : keyOverride;
      if (!navigation || !indicator) return;

      navigation.dataset.visualActive = key ?? "none";

      const target = key ? linkRefs.current[key] : null;
      const next: IndicatorMotion = target
        ? {
            opacity: 1,
            width: target.offsetWidth,
            x: target.offsetLeft,
          }
        : {
            ...motionState.current,
            opacity: 0,
          };
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      motionRef.current?.cancel();
      shapeMotionRef.current?.cancel();

      if (!withMotion || reducedMotion) {
        Object.assign(motionState.current, next);
        renderIndicator();
        if (indicatorCoreRef.current) {
          indicatorCoreRef.current.style.transform = "scale(1)";
        }
        return;
      }

      motionRef.current = animate(motionState.current, {
        opacity: next.opacity,
        width: next.width,
        x: next.x,
        duration: 260,
        ease: "out(4)",
        onUpdate: renderIndicator,
        onComplete: renderIndicator,
      });

      const core = indicatorCoreRef.current;
      if (core && target) {
        shapeMotionRef.current = animate(core, {
          scaleX: [1, 1.14, 1],
          scaleY: [1, 0.88, 1],
          duration: 260,
          ease: "inOut(3)",
        });
      }
    },
    [renderIndicator],
  );

  useLayoutEffect(() => {
    activeKeyRef.current = activeKey;
    if (optimisticResetRef.current !== null) {
      window.clearTimeout(optimisticResetRef.current);
      optimisticResetRef.current = null;
    }
    const firstPosition = !initializedRef.current;
    positionIndicator(!firstPosition);
    initializedRef.current = true;
    navigationRef.current?.setAttribute("data-enhanced", "true");
  }, [activeKey, positionIndicator]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;

    let frame = 0;
    const snapToLayout = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => positionIndicator(false));
    };
    const observer = new ResizeObserver(snapToLayout);
    observer.observe(navigation);
    for (const link of Object.values(linkRefs.current)) {
      if (link) observer.observe(link);
    }
    window.addEventListener("resize", snapToLayout, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", snapToLayout);
      window.cancelAnimationFrame(frame);
      if (optimisticResetRef.current !== null) {
        window.clearTimeout(optimisticResetRef.current);
      }
      motionRef.current?.cancel();
      shapeMotionRef.current?.cancel();
    };
  }, [positionIndicator]);

  return (
    <nav
      className={styles.navigation}
      aria-label="Primary navigation"
      data-active-key={activeKey ?? "none"}
      data-primary-navigation
      ref={navigationRef}
    >
      <span
        aria-hidden="true"
        className={styles.navigationIndicator}
        data-primary-navigation-indicator
        ref={indicatorRef}
      >
        <span ref={indicatorCoreRef} />
      </span>
      {items.map(([label, href]) => {
        const key = href.slice(1) as NavigationKey;
        const current = activeKey === key;
        return (
          <Link
            aria-current={current ? "page" : undefined}
            data-navigation-key={key}
            href={href}
            key={href}
            onNavigate={() => {
              if (current) return;
              if (optimisticResetRef.current !== null) {
                window.clearTimeout(optimisticResetRef.current);
              }
              positionIndicator(true, key);
              optimisticResetRef.current = window.setTimeout(() => {
                optimisticResetRef.current = null;
                positionIndicator(true);
              }, 4_000);
            }}
            prefetch={false}
            ref={(node) => {
              if (node) linkRefs.current[key] = node;
              else delete linkRefs.current[key];
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
