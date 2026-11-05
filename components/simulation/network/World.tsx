"use client";
import { useEffect, useRef } from "react";
import type { CharacterId } from "@/lib/simulation/network/characters";
import type { WorldRenderer, WorldView } from "./renderer";
import styles from "./Network.module.css";
export function World({
  view,
  move,
  meet,
  inspect,
  fail,
}: {
  view: WorldView;
  move(x: number, y: number): void;
  meet(id: CharacterId): void;
  inspect(id: string): void;
  fail(): void;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<WorldRenderer | null>(null);
  const latest = useRef({ view, move, meet, inspect, fail });
  useEffect(() => {
    latest.current = { view, move, meet, inspect, fail };
    renderer.current?.update(view);
  }, [view, move, meet, inspect, fail]);
  useEffect(() => {
    let stopped = false;
    void import("./renderer")
      .then(({ createNetworkRenderer }) => {
        if (!stopped && host.current)
          renderer.current = createNetworkRenderer(
            host.current,
            latest.current.view,
            (x, y) => latest.current.move(x, y),
            (id) => latest.current.meet(id),
            (id) => latest.current.inspect(id),
            () => latest.current.fail(),
          );
      })
      .catch(() => latest.current.fail());
    return () => {
      stopped = true;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);
  return (
    <div
      ref={host}
      data-network-canvas
      className={styles.canvasHost}
      aria-hidden="true"
    />
  );
}
