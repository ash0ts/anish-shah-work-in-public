"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WorkArchiveRecord } from "@/lib/work-index";

const laneY = { teach: 2.05, build: 0, convene: -2.05 } as const;
const laneColor = {
  teach: 0xe6a23c,
  build: 0x295dff,
  convene: 0xf04e85,
} as const;

function unitHash(value: string, offset = 0) {
  let hash = 2166136261 + offset;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function mapAllowed() {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function VisualArchive({ works }: { works: WorkArchiveRecord[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const updateSelectionRef = useRef<((id: string) => void) | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "static">("loading");
  const [selectedId, setSelectedId] = useState(works[0]?.id ?? "");
  const selected = works.find((work) => work.id === selectedId) ?? works[0] ?? null;

  useEffect(() => {
    if (!hostRef.current || !mapAllowed()) {
      setStatus("static");
      return;
    }

    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      try {
        const THREE = await import("three");
        if (disposed || !hostRef.current) return;

        const host = hostRef.current;
        const width = Math.max(host.clientWidth, 320);
        const height = Math.max(host.clientHeight, 520);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(33, width / height, 0.1, 80);
        camera.position.set(0, 5.8, 13.5);
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

        const years = works
          .map((work) => work.year)
          .filter((year): year is number => year !== null);
        const firstYear = years.length ? Math.min(...years) : 2021;
        const lastYear = years.length ? Math.max(...years) : firstYear + 1;
        const span = Math.max(lastYear - firstYear, 1);
        const xFor = (work: WorkArchiveRecord) =>
          work.year === null
            ? 5.25
            : -5.15 +
              ((work.year - firstYear) / span) * 9.6 +
              (unitHash(work.id) - 0.5) * 0.78;
        const yFor = (work: WorkArchiveRecord) =>
          laneY[work.practice] + (unitHash(work.id, 31) - 0.5) * 0.62;

        const workGeometry = new THREE.BoxGeometry(0.15, 1, 1);
        const workGroups = (
          Object.keys(laneY) as Array<keyof typeof laneY>
        ).map((practice) => {
          const workIndices = works.flatMap((work, index) =>
            work.practice === practice ? [index] : [],
          );
          const material = new THREE.MeshBasicMaterial({
            color: laneColor[practice],
          });
          const mesh = new THREE.InstancedMesh(
            workGeometry,
            material,
            workIndices.length,
          );
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.userData.workIndices = workIndices;
          return { practice, workIndices, material, mesh };
        });
        const workMeshes = workGroups.map((group) => group.mesh);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        const satellitePositions: number[] = [];
        const satelliteColors: number[] = [];
        const relationPositions: number[] = [];
        const satelliteColor = new THREE.Color();
        works.forEach((work) => {
          const primaryX = xFor(work);
          const primaryY = yFor(work);
          work.childItems.slice(0, 12).forEach((child, childIndex) => {
            const angle =
              (childIndex / Math.max(Math.min(work.childItems.length, 12), 1)) *
              Math.PI *
              2;
            const radius = 0.25 + Math.min(childIndex, 5) * 0.035;
            const childX = primaryX + Math.cos(angle) * radius;
            const childY = primaryY + Math.sin(angle) * radius;
            const childZ = -0.22 - (childIndex % 3) * 0.08;
            satellitePositions.push(childX, childY, childZ);
            if (child.type === "recording") satelliteColor.setHex(0x15a88a);
            else if (child.type === "translation" || child.type === "mirror") {
              satelliteColor.setHex(0xe6a23c);
            } else if (
              child.type === "open_source_repo" ||
              child.type === "open_source_pr"
            ) {
              satelliteColor.setHex(0x8ca5ff);
            } else satelliteColor.setHex(0x9ba4b6);
            satelliteColors.push(
              satelliteColor.r,
              satelliteColor.g,
              satelliteColor.b,
            );
            relationPositions.push(
              primaryX,
              primaryY,
              -0.08,
              childX,
              childY,
              childZ,
            );
          });
        });

        const satelliteGeometry = new THREE.BufferGeometry();
        satelliteGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(satellitePositions, 3),
        );
        satelliteGeometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(satelliteColors, 3),
        );
        const satelliteMaterial = new THREE.PointsMaterial({
          size: 0.07,
          vertexColors: true,
          sizeAttenuation: true,
        });
        const satellites = new THREE.Points(
          satelliteGeometry,
          satelliteMaterial,
        );

        const relationGeometry = new THREE.BufferGeometry();
        relationGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(relationPositions, 3),
        );
        const relationMaterial = new THREE.LineBasicMaterial({
          color: 0x17223b,
          transparent: true,
          opacity: 0.16,
        });
        const relations = new THREE.LineSegments(
          relationGeometry,
          relationMaterial,
        );

        const guidePositions: number[] = [];
        (Object.keys(laneY) as Array<keyof typeof laneY>).forEach((practice) => {
          guidePositions.push(-5.5, laneY[practice], -0.35, 5.55, laneY[practice], -0.35);
        });
        const guideGeometry = new THREE.BufferGeometry();
        guideGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(guidePositions, 3),
        );
        const guideMaterial = new THREE.LineBasicMaterial({
          color: 0x17223b,
          transparent: true,
          opacity: 0.18,
        });
        const guides = new THREE.LineSegments(guideGeometry, guideMaterial);
        scene.add(guides, relations, satellites, ...workMeshes);

        const place = (activeId: string) => {
          workGroups.forEach(({ mesh, workIndices }) => {
            workIndices.forEach((workIndex, instanceIndex) => {
              const work = works[workIndex];
              const active = work.id === activeId;
              const height = Math.min(0.55 + work.formCount * 0.08, 1.45);
              position.set(xFor(work), yFor(work), active ? 0.5 : 0);
              scale.set(active ? 1.9 : 1, height, 0.28 + work.formCount * 0.04);
              matrix.compose(position, quaternion, scale);
              mesh.setMatrixAt(instanceIndex, matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
          });
          renderer.render(scene, camera);
        };
        updateSelectionRef.current = place;
        place(works[0]?.id ?? "");

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const inspect = (event: PointerEvent) => {
          const bounds = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(workMeshes)[0];
          const hitWorkIndex =
            hit?.instanceId === undefined
              ? undefined
              : (hit.object.userData.workIndices as number[] | undefined)?.[
                  hit.instanceId
                ];
          renderer.domElement.style.cursor =
            hitWorkIndex === undefined ? "default" : "pointer";
          if (event.type === "pointerdown" && hitWorkIndex !== undefined) {
            setSelectedId(works[hitWorkIndex].id);
          }
        };
        renderer.domElement.addEventListener("pointermove", inspect);
        renderer.domElement.addEventListener("pointerdown", inspect);

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
        setStatus("ready");

        cleanup = () => {
          updateSelectionRef.current = null;
          resize.disconnect();
          renderer.domElement.removeEventListener("pointermove", inspect);
          renderer.domElement.removeEventListener("pointerdown", inspect);
          workGeometry.dispose();
          workGroups.forEach(({ material }) => material.dispose());
          satelliteGeometry.dispose();
          satelliteMaterial.dispose();
          relationGeometry.dispose();
          relationMaterial.dispose();
          guideGeometry.dispose();
          guideMaterial.dispose();
          renderer.dispose();
          if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
        };
      } catch {
        if (!disposed) setStatus("static");
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [works]);

  useEffect(() => {
    updateSelectionRef.current?.(selectedId);
    const panel = document.querySelector("[data-map-selection]");
    if (!panel || status !== "ready") return;
    let cancelled = false;
    void import("animejs").then(({ animate }) => {
      if (cancelled) return;
      animate(panel, {
        opacity: [0.55, 1],
        translateY: ["0.45rem", 0],
        duration: 420,
        ease: "out(4)",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, status]);

  return (
    <section className="v11-map" aria-labelledby="map-title">
      <header>
        <div>
          <p className="utility-label">One work · many public forms</p>
          <h2 id="map-title">The workgraph.</h2>
        </div>
        <p>
          Time runs left to right. Teach, Build, and Convene form stable lanes.
          Smaller marks are recordings, translations, implementations, and
          references attached to the work they represent.
        </p>
      </header>

      <div className="v11-map-legend" aria-label="Map legend">
        <span><i data-color="teach" /> Teach</span>
        <span><i data-color="build" /> Build</span>
        <span><i data-color="convene" /> Convene</span>
        <span><b /> Canonical work</span>
        <span><small /> Public form</span>
      </div>

      <div className="v11-map-layout">
        <div className="v11-map-stage">
          <div className="v11-map-axis" aria-hidden="true">
            <span>2021</span><span>2022</span><span>2023</span>
            <span>2024</span><span>2025</span><span>Now</span><span>Undated</span>
          </div>
          <div className="v11-map-canvas" ref={hostRef}>
            {status !== "ready" ? (
              <div className="v11-map-static">
                <span>Teach</span>
                <span>Build</span>
                <span>Convene</span>
              </div>
            ) : null}
          </div>
          {status === "loading" ? (
            <p className="v11-map-status">Opening the visual archive…</p>
          ) : null}
          {status === "static" ? (
            <p className="v11-map-status">
              The visual layer is disabled for this device or preference. The
              complete index remains available below.
            </p>
          ) : null}
        </div>

        <aside className="v11-map-inspector" data-map-selection>
          <label>
            <span>Inspect a work</span>
            <select
              value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {works.map((work) => (
                <option key={work.id} value={work.id}>
                  {work.year ?? "Undated"} · {work.title}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <>
              <p>
                {selected.practice} · {selected.year ?? "undated"} ·{" "}
                {selected.formCount} public{" "}
                {selected.formCount === 1 ? "form" : "forms"}
              </p>
              <h3>{selected.title}</h3>
              <span>{selected.role}</span>
              {selected.childItems.length ? (
                <ul>
                  {selected.childItems.slice(0, 5).map((child) => (
                    <li key={child.id}>
                      {child.type.replaceAll("_", " ")} · {child.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>This work currently has one public form.</p>
              )}
              <Link href={`/work/${selected.slug}`}>Open this work ↗</Link>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
