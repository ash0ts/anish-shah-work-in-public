"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PortfolioItem } from "@/types/content";

type VisualItem = Pick<
  PortfolioItem,
  "id" | "slug" | "title" | "type" | "year" | "topics"
>;

const colorByType: Record<string, number> = {
  course: 0xe6a23c,
  event: 0xf04e85,
  recording: 0x15a88a,
  article: 0x295dff,
  open_source_repo: 0x8ca5ff,
  open_source_pr: 0x8ca5ff,
};

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function VisualArchive({ items }: { items: VisualItem[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<VisualItem | null>(null);

  useEffect(() => {
    if (!active || !hostRef.current) return;

    let disposed = false;
    let frame = 0;
    let cleanup = () => {};

    void (async () => {
      setLoading(true);
      try {
        const THREE = await import("three");
        if (disposed || !hostRef.current) return;
        const host = hostRef.current;
        const width = Math.max(host.clientWidth, 320);
        const height = Math.max(host.clientHeight, 460);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
        camera.position.set(0, 0.2, 10.5);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(width, height);
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);

        const positions: number[] = [];
        const colors: number[] = [];
        const color = new THREE.Color();
        const types = [...new Set(items.map((item) => item.type))];
        items.forEach((item, index) => {
          const year = item.year ?? 2021;
          const x = ((year - 2021) / 5) * 8 - 4;
          const band = types.indexOf(item.type);
          const baseY = types.length > 1 ? (band / (types.length - 1)) * 5 - 2.5 : 0;
          const jitter = hash(item.id);
          const y = baseY + (((jitter >>> 8) % 100) / 100 - 0.5) * 0.52;
          const z = (((jitter >>> 16) % 100) / 100 - 0.5) * 2.6;
          positions.push(x, y, z);
          color.setHex(colorByType[item.type] ?? 0xf4f7f8);
          colors.push(color.r, color.g, color.b);
          if (index === 0) setSelected(item);
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
          size: 0.13,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.96,
        });
        const points = new THREE.Points(geometry, material);
        scene.add(points);

        const lines: number[] = [];
        for (let year = 0; year < 6; year += 1) {
          const x = (year / 5) * 8 - 4;
          lines.push(x, -3.2, -1.5, x, 3.2, -1.5);
        }
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(lines, 3),
        );
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.1,
        });
        scene.add(new THREE.LineSegments(lineGeometry, lineMaterial));

        const raycaster = new THREE.Raycaster();
        raycaster.params.Points.threshold = 0.16;
        const pointer = new THREE.Vector2();
        const inspect = (event: PointerEvent) => {
          const bounds = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObject(points)[0];
          renderer.domElement.style.cursor = hit ? "pointer" : "crosshair";
          if (hit?.index !== undefined) setSelected(items[hit.index]);
        };
        renderer.domElement.addEventListener("pointermove", inspect);

        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const started = performance.now();
        const render = (now: number) => {
          if (disposed) return;
          if (!reduced) {
            points.rotation.y = Math.sin((now - started) / 9000) * 0.12;
          }
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);

        const resize = new ResizeObserver(([entry]) => {
          const nextWidth = entry.contentRect.width;
          const nextHeight = entry.contentRect.height;
          camera.aspect = nextWidth / nextHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(nextWidth, nextHeight);
        });
        resize.observe(host);
        setLoading(false);

        cleanup = () => {
          resize.disconnect();
          renderer.domElement.removeEventListener("pointermove", inspect);
          cancelAnimationFrame(frame);
          geometry.dispose();
          material.dispose();
          lineGeometry.dispose();
          lineMaterial.dispose();
          renderer.dispose();
          if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
        };
      } catch {
        setFailed(true);
        setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [active, items]);

  return (
    <section className="visual-archive" aria-labelledby="visual-archive-title">
      <div className="visual-archive-copy">
        <p className="utility-label">
          {items.length} artifacts · one explorable surface
        </p>
        <h2 id="visual-archive-title">See the shape of the work.</h2>
        <p>
          Every point is a public artifact. Time runs left to right; formats
          occupy distinct bands. The visualization loads only when you ask for it.
        </p>
        {!active ? (
          <button
            className="archive-open-button"
            type="button"
            onClick={() => setActive(true)}
          >
            Open visual archive <span aria-hidden="true">↗</span>
          </button>
        ) : null}
        {active && selected ? (
          <Link className="visual-selection" href={`/work/${selected.slug}`}>
            <span>
              {selected.year ?? "Date open"} · {selected.type.replaceAll("_", " ")}
            </span>
            <strong>{selected.title}</strong>
            <i>Open record ↗</i>
          </Link>
        ) : null}
        {loading ? <p className="archive-loading">Building the public map…</p> : null}
        {failed ? (
          <p className="archive-loading">
            The visual map is unavailable. The complete accessible index remains below.
          </p>
        ) : null}
      </div>
      <div className="visual-archive-stage">
        <div className="visual-archive-years" aria-hidden="true">
          {["2021", "2022", "2023", "2024", "2025", "Now"].map((year) => (
            <span key={year}>{year}</span>
          ))}
        </div>
        <div className="visual-archive-canvas" ref={hostRef}>
          {!active ? (
            <span className="visual-archive-placeholder">{items.length}</span>
          ) : null}
        </div>
      </div>
      <details className="visual-archive-fallback">
        <summary>View the accessible visual-archive list</summary>
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/work/${item.slug}`}>
                {item.year ?? "Date open"} · {item.title}
              </Link>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
