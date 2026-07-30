"use client";

import { useEffect, useRef, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function Reveal({ children, className = "", delay = 0 }: RevealProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || cancelled) return;
        observer.disconnect();
        const { animate } = await import("animejs");
        if (cancelled) return;
        animate(element, {
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 720,
          delay,
          ease: "out(3)",
        });
      },
      { threshold: 0.12 },
    );

    element.style.opacity = "0";
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      element.style.removeProperty("opacity");
      element.style.removeProperty("transform");
    };
  }, [delay]);

  return (
    <div ref={elementRef} className={className}>
      {children}
    </div>
  );
}
