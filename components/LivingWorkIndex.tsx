"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type WorkIndexEntry = {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  practice: "teach" | "build" | "convene";
  formCount: number;
  kind: string;
  role: string;
};

type LoadMode = "static" | "loading" | "three" | "unavailable";

const practiceOrder = ["teach", "build", "convene"] as const;
function stableUnit(value: string, offset = 0) {
  let hash = 2166136261 + offset;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function canLoadThree() {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
        canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }),
    );
  } catch {
    return false;
  }
}

export function LivingWorkIndex({
  entries,
  autoLoadDesktop = false,
  compact = false,
}: {
  entries: WorkIndexEntry[];
  autoLoadDesktop?: boolean;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const updateSelectionRef = useRef<((id: string) => void) | null>(null);
  const [mode, setMode] = useState<LoadMode>("static");
  const [activated, setActivated] = useState(false);
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? "");
  const selected =
    entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const selectedIndex = Math.max(
    entries.findIndex((entry) => entry.id === selected?.id),
    0,
  );
  const stepSelection = (direction: -1 | 1) => {
    if (!entries.length) return;
    const nextIndex =
      (selectedIndex + direction + entries.length) % entries.length;
    setSelectedId(entries[nextIndex].id);
  };

  const practiceSummary = useMemo(
    () =>
      practiceOrder.map((practice) => {
        const matching = entries.filter((entry) => entry.practice === practice);
        const years = matching
          .map((entry) => entry.year)
          .filter((year): year is number => year !== null);
        return {
          practice,
          count: matching.length,
          firstYear: years.length ? Math.min(...years) : null,
          lastYear: years.length ? Math.max(...years) : null,
        };
      }),
    [entries],
  );

  useEffect(() => {
    if (!autoLoadDesktop || window.innerWidth < 900 || !canLoadThree()) return;
    const timer = window.setTimeout(() => {
      setMode("loading");
      setActivated(true);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [autoLoadDesktop]);

  useEffect(() => {
    if (!activated || !hostRef.current) return;

    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      try {
        const THREE = await import("three");
        if (disposed || !hostRef.current) return;

        const host = hostRef.current;
        const width = Math.max(host.clientWidth, 320);
        const height = Math.max(host.clientHeight, compact ? 360 : 480);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 60);
        camera.position.set(0, 4.9, 11.6);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.tabIndex = -1;
        host.appendChild(renderer.domElement);

        const yearValues = entries
          .map((entry) => entry.year)
          .filter((year): year is number => year !== null);
        const firstYear = yearValues.length ? Math.min(...yearValues) : 2021;
        const lastYear = yearValues.length ? Math.max(...yearValues) : firstYear + 1;
        const yearSpan = Math.max(lastYear - firstYear, 1);
        const laneY = { teach: 1.7, build: 0, convene: -1.7 } as const;
        const geometry = new THREE.BoxGeometry(0.13, 1, 1);
        const material = new THREE.MeshBasicMaterial({ color: 0x295dff });
        const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        const placeInstances = (activeId: string) => {
          entries.forEach((entry, index) => {
            const isSelected = entry.id === activeId;
            const baseX =
              entry.year === null
                ? 4.42
                : -4.25 + ((entry.year - firstYear) / yearSpan) * 7.9;
            const x =
              baseX +
              (entry.year === null ? 0 : (stableUnit(entry.id) - 0.5) * 0.86);
            const y =
              laneY[entry.practice] + (stableUnit(entry.id, 17) - 0.5) * 0.58;
            const heightValue = Math.min(0.55 + entry.formCount * 0.1, 1.5);
            position.set(x, y, isSelected ? 0.38 : 0);
            scale.set(isSelected ? 1.8 : 1, heightValue, 0.25 + entry.formCount * 0.07);
            matrix.compose(position, quaternion, scale);
            mesh.setMatrixAt(index, matrix);
          });
          mesh.instanceMatrix.needsUpdate = true;
          renderer.render(scene, camera);
        };
        updateSelectionRef.current = placeInstances;

        scene.add(mesh);

        const guideMaterial = new THREE.LineBasicMaterial({
          color: 0x17223b,
          transparent: true,
          opacity: 0.2,
        });
        const guidePositions: number[] = [];
        practiceOrder.forEach((practice) => {
          guidePositions.push(-4.55, laneY[practice], -0.18, 4.65, laneY[practice], -0.18);
        });
        const guideGeometry = new THREE.BufferGeometry();
        guideGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(guidePositions, 3),
        );
        scene.add(new THREE.LineSegments(guideGeometry, guideMaterial));

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const pick = (event: PointerEvent) => {
          const bounds = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObject(mesh)[0];
          const instanceId = hit?.instanceId;
          renderer.domElement.style.cursor =
            instanceId === undefined ? "default" : "pointer";
          if (event.type === "pointerdown" && instanceId !== undefined) {
            setSelectedId(entries[instanceId].id);
          }
        };
        renderer.domElement.addEventListener("pointermove", pick);
        renderer.domElement.addEventListener("pointerdown", pick);

        const resize = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const nextWidth = Math.max(entry.contentRect.width, 1);
          const nextHeight = Math.max(entry.contentRect.height, 1);
          camera.aspect = nextWidth / nextHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(nextWidth, nextHeight);
          renderer.render(scene, camera);
        });
        resize.observe(host);
        placeInstances(entries[0]?.id ?? "");
        setMode("three");

        cleanup = () => {
          updateSelectionRef.current = null;
          resize.disconnect();
          renderer.domElement.removeEventListener("pointermove", pick);
          renderer.domElement.removeEventListener("pointerdown", pick);
          geometry.dispose();
          material.dispose();
          guideGeometry.dispose();
          guideMaterial.dispose();
          renderer.dispose();
          if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
        };
      } catch {
        if (!disposed) setMode("unavailable");
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [activated, entries, compact]);

  useEffect(() => {
    if (mode !== "three" || !hostRef.current) return;
    updateSelectionRef.current?.(selectedId);
    let cancelled = false;
    void import("animejs").then(({ animate }) => {
      if (cancelled || !hostRef.current) return;
      animate(hostRef.current, {
        opacity: [0.72, 1],
        duration: 420,
        ease: "out(3)",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedId]);

  return (
    <section
      className={`living-index${compact ? " living-index-compact" : ""}`}
      aria-label="Living work index"
    >
      <div className="living-index-head">
        <p className="utility-label">One body of work · many public forms</p>
        <span>{entries.length} canonical works</span>
      </div>

      <div className="living-index-stage" ref={hostRef}>
        {mode !== "three" ? (
          <div className="living-index-static" aria-label="Work by practice">
            {practiceSummary.map((lane) => (
              <div data-practice={lane.practice} key={lane.practice}>
                <span>{lane.practice}</span>
                <i />
                <strong>{lane.count}</strong>
                <small>
                  {lane.firstYear && lane.lastYear
                    ? `${lane.firstYear}—${lane.lastYear}`
                    : "Date open"}
                </small>
              </div>
            ))}
          </div>
        ) : null}
        {mode === "loading" ? (
          <span className="living-index-loading">Opening the work index…</span>
        ) : null}
      </div>

      <div className="living-index-controls">
        <div className="living-index-stepper" aria-label="Choose a work">
          <button
            type="button"
            aria-label="Previous work"
            onClick={() => stepSelection(-1)}
          >
            ←
          </button>
          <span>
            {String(selectedIndex + 1).padStart(2, "0")} /{" "}
            {String(entries.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label="Next work"
            onClick={() => stepSelection(1)}
          >
            →
          </button>
        </div>
        {selected ? (
          <Link href={`/work/${selected.slug}`}>
            <span>
              {selected.practice} · {selected.year ?? "undated"} ·{" "}
              {selected.formCount} {selected.formCount === 1 ? "form" : "forms"}
            </span>
            <strong>{selected.title}</strong>
            <i aria-hidden="true">↗</i>
          </Link>
        ) : null}
      </div>

      {mode === "static" && canRenderActivation(autoLoadDesktop) ? (
        <button
          className="living-index-activate"
          type="button"
          onClick={() => {
            if (!canLoadThree()) {
              setMode("unavailable");
              return;
            }
            setMode("loading");
            setActivated(true);
          }}
        >
          Activate 3D index
        </button>
      ) : null}
      {mode === "unavailable" ? (
        <p className="living-index-note">
          The typographic index is active. The 3D view is unavailable for this
          device or preference.
        </p>
      ) : null}
    </section>
  );
}

function canRenderActivation(autoLoadDesktop: boolean) {
  if (!autoLoadDesktop) return true;
  return true;
}
