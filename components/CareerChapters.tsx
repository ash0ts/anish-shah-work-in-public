"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type {
  CareerChapterId,
  ResolvedCareerChapter,
} from "@/lib/career-chapters";
import styles from "./CareerChapters.module.css";

type ChapterSceneMode = "static" | "loading" | "three" | "unavailable";
type CancellableAnimation = {
  cancel: () => unknown;
  complete: () => unknown;
};

type CareerChaptersProps = {
  chapters: ResolvedCareerChapter[];
  defaultChapterId: CareerChapterId | null;
  canEnhanceWithThree: boolean;
};

type NetworkNavigator = Navigator & {
  connection?: { saveData?: boolean };
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function supportsOptionalScene() {
  if (window.innerWidth < 960) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  if ((navigator as NetworkNavigator).connection?.saveData) return false;
  try {
    const probe = document.createElement("canvas");
    return Boolean(
      probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
        probe.getContext("webgl", { failIfMajorPerformanceCaveat: true }),
    );
  } catch {
    return false;
  }
}

export function CareerChapters({
  chapters,
  defaultChapterId,
  canEnhanceWithThree,
}: CareerChaptersProps) {
  const initialIndex = Math.max(
    chapters.findIndex((chapter) => chapter.id === defaultChapterId),
    0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [sceneMode, setSceneMode] = useState<ChapterSceneMode>("static");
  const [sceneActivated, setSceneActivated] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const detailRefs = useRef<Array<HTMLDetailsElement | null>>([]);
  const panelAnimationRef = useRef<CancellableAnimation | null>(null);
  const sceneSelectionRef = useRef<((index: number) => void) | null>(null);
  const selectedIndexRef = useRef(selectedIndex);

  const selectChapter = useCallback(
    (nextIndex: number, focusControl = false) => {
      if (nextIndex < 0 || nextIndex >= chapters.length) return;
      panelAnimationRef.current?.complete();
      panelAnimationRef.current?.cancel();
      panelAnimationRef.current = null;
      selectedIndexRef.current = nextIndex;
      setSelectedIndex(nextIndex);
      sceneSelectionRef.current?.(nextIndex);
      if (focusControl) {
        window.requestAnimationFrame(() => {
          detailRefs.current[nextIndex]
            ?.querySelector("summary")
            ?.focus();
        });
      }
    },
    [chapters.length],
  );

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    const details = detailRefs.current[selectedIndex];
    const panel = details?.querySelector<HTMLElement>("[data-chapter-panel]");
    if (
      !panel ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let disposed = false;
    void import("animejs").then(({ animate }) => {
      if (disposed) return;
      panelAnimationRef.current = animate(panel, {
        opacity: [0.45, 1],
        translateY: ["0.5rem", 0],
        duration: 430,
        ease: "out(4)",
      });
    });
    return () => {
      disposed = true;
    };
  }, [selectedIndex]);

  useEffect(() => {
    if (!canEnhanceWithThree || !supportsOptionalScene()) return;

    let disposed = false;
    let frame = 0;
    let idleHandle: number | null = null;
    const idleWindow = window as IdleWindow;
    frame = window.requestAnimationFrame(() => {
      if (disposed) return;
      const activate = () => {
        if (disposed || !supportsOptionalScene()) return;
        setSceneMode("loading");
        setSceneActivated(true);
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(activate, { timeout: 900 });
      } else {
        idleHandle = window.setTimeout(activate, 420);
      }
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      if (idleHandle !== null) {
        if (idleWindow.cancelIdleCallback) {
          idleWindow.cancelIdleCallback(idleHandle);
        } else {
          window.clearTimeout(idleHandle);
        }
      }
    };
  }, [canEnhanceWithThree]);

  useEffect(() => {
    if (!sceneActivated || !stageRef.current) return;

    let disposed = false;
    let disposeScene = () => {};

    void (async () => {
      try {
        const [THREE, { animate }] = await Promise.all([
          import("three"),
          import("animejs"),
        ]);
        if (disposed || !stageRef.current) return;

        const host = stageRef.current;
        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
        const resourceDisposers: Array<() => void> = [];
        let cleaned = false;
        let activeAnimation: CancellableAnimation | null = null;
        let resize: ResizeObserver | null = null;
        let contextLossHandler: ((event: Event) => void) | null = null;
        const teardown = () => {
          if (cleaned) return;
          cleaned = true;
          activeAnimation?.cancel();
          sceneSelectionRef.current = null;
          resize?.disconnect();
          if (contextLossHandler) {
            renderer.domElement.removeEventListener(
              "webglcontextlost",
              contextLossHandler,
            );
          }
          while (resourceDisposers.length) {
            try {
              resourceDisposers.pop()?.();
            } catch {
              // Continue releasing the remaining GPU resources.
            }
          }
          try {
            renderer.dispose();
          } catch {
            // The DOM fallback is still restored if the WebGL driver fails.
          } finally {
            if (host.contains(renderer.domElement)) {
              host.removeChild(renderer.domElement);
            }
          }
        };
        // Install cleanup before the canvas or any GPU resources are created so
        // every partial-initialization failure returns to the static fallback.
        disposeScene = teardown;
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.tabIndex = -1;
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-5.4, 5.4, 3.2, -3.2, 0.1, 30);
        camera.position.set(0, 4.4, 10);
        camera.lookAt(0, 0, 0);
        scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c0d5, 2.5));
        const directional = new THREE.DirectionalLight(0xffffff, 2.2);
        directional.position.set(-4, 7, 8);
        scene.add(directional);

        const slabGeometry = new THREE.BoxGeometry(1.42, 3.1, 0.26);
        resourceDisposers.push(() => slabGeometry.dispose());
        const leafGeometry = new THREE.BoxGeometry(1.08, 2.52, 0.055);
        resourceDisposers.push(() => leafGeometry.dispose());
        const baseColor = new THREE.Color(0xdfe4ea);
        const activeColor = new THREE.Color(0x295dff);
        const leafColors = [0xf04e85, 0xe6a23c, 0x15a88a];
        const spacing = chapters.length > 1 ? 7.8 / (chapters.length - 1) : 0;

        const slabs = chapters.map((chapter, index) => {
          const material = new THREE.MeshStandardMaterial({
            color: index === selectedIndexRef.current ? activeColor : baseColor,
            metalness: 0,
            roughness: 0.72,
          });
          resourceDisposers.push(() => material.dispose());
          const mesh = new THREE.Mesh(slabGeometry, material);
          mesh.name = chapter.id;
          mesh.position.set(-3.9 + index * spacing, 0, 0);
          mesh.rotation.x = -0.08;
          scene.add(mesh);
          return mesh;
        });

        const leafGroups = chapters.map((chapter, chapterIndex) => {
          const group = new THREE.Group();
          group.position.x = -3.9 + chapterIndex * spacing;
          chapter.works.forEach((_work, workIndex) => {
            const center = (chapter.works.length - 1) / 2;
            const material = new THREE.MeshStandardMaterial({
              color: leafColors[workIndex % leafColors.length],
              metalness: 0,
              roughness: 0.8,
            });
            resourceDisposers.push(() => material.dispose());
            const leaf = new THREE.Mesh(leafGeometry, material);
            leaf.position.set(
              (workIndex - center) * 0.18,
              0.2 + Math.abs(workIndex - center) * 0.06,
              0.36 + workIndex * 0.1,
            );
            leaf.rotation.z = (workIndex - center) * 0.045;
            group.add(leaf);
          });
          scene.add(group);
          return group;
        });

        const guideGeometry = new THREE.BufferGeometry();
        resourceDisposers.push(() => guideGeometry.dispose());
        guideGeometry.setFromPoints([
          new THREE.Vector3(-4.7, -1.95, -0.2),
          new THREE.Vector3(4.7, -1.95, -0.2),
        ]);
        const guideMaterial = new THREE.LineBasicMaterial({
          color: 0x17223b,
          transparent: true,
          opacity: 0.24,
        });
        resourceDisposers.push(() => guideMaterial.dispose());
        scene.add(new THREE.Line(guideGeometry, guideMaterial));

        const render = () => renderer.render(scene, camera);
        const applyFinalState = (index: number) => {
          slabs.forEach((slab, slabIndex) => {
            const active = slabIndex === index;
            slab.position.y = active ? 0.18 : 0;
            slab.position.z = active ? 0.72 : 0;
            (slab.material as InstanceType<typeof THREE.MeshStandardMaterial>)
              .color.copy(active ? activeColor : baseColor);
          });
          leafGroups.forEach((group, groupIndex) => {
            const active = groupIndex === index;
            group.visible = active;
            group.scale.setScalar(active ? 1 : 0.001);
            group.position.z = active ? 0.72 : 0;
          });
          render();
        };

        let activeIndex = selectedIndexRef.current;
        applyFinalState(activeIndex);

        const transitionTo = (nextIndex: number) => {
          if (nextIndex < 0 || nextIndex >= chapters.length) return;
          activeAnimation?.complete();
          activeAnimation?.cancel();
          activeAnimation = null;

          const slabStarts = slabs.map((slab) => ({
            y: slab.position.y,
            z: slab.position.z,
            color: (
              slab.material as InstanceType<typeof THREE.MeshStandardMaterial>
            ).color.clone(),
          }));
          const groupStarts = leafGroups.map((group) => ({
            scale: group.scale.x,
            z: group.position.z,
          }));
          leafGroups[nextIndex].visible = true;
          leafGroups[activeIndex].visible = true;
          const progress = { value: 0 };

          activeAnimation = animate(progress, {
            value: 1,
            duration: 560,
            ease: "out(4)",
            onUpdate: () => {
              const amount = progress.value;
              slabs.forEach((slab, slabIndex) => {
                const active = slabIndex === nextIndex;
                slab.position.y = THREE.MathUtils.lerp(
                  slabStarts[slabIndex].y,
                  active ? 0.18 : 0,
                  amount,
                );
                slab.position.z = THREE.MathUtils.lerp(
                  slabStarts[slabIndex].z,
                  active ? 0.72 : 0,
                  amount,
                );
                (
                  slab.material as InstanceType<
                    typeof THREE.MeshStandardMaterial
                  >
                ).color.lerpColors(
                  slabStarts[slabIndex].color,
                  active ? activeColor : baseColor,
                  amount,
                );
              });
              leafGroups.forEach((group, groupIndex) => {
                const active = groupIndex === nextIndex;
                const scale = THREE.MathUtils.lerp(
                  groupStarts[groupIndex].scale,
                  active ? 1 : 0.001,
                  amount,
                );
                group.scale.setScalar(scale);
                group.position.z = THREE.MathUtils.lerp(
                  groupStarts[groupIndex].z,
                  active ? 0.72 : 0,
                  amount,
                );
              });
              render();
            },
            onComplete: () => {
              activeIndex = nextIndex;
              applyFinalState(nextIndex);
              activeAnimation = null;
            },
          });
        };
        sceneSelectionRef.current = transitionTo;

        resize = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const width = Math.max(entry.contentRect.width, 1);
          const height = Math.max(entry.contentRect.height, 1);
          const aspect = width / height;
          const viewWidth = 10.8;
          camera.left = -viewWidth / 2;
          camera.right = viewWidth / 2;
          camera.top = viewWidth / aspect / 2;
          camera.bottom = -viewWidth / aspect / 2;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
          render();
        });
        resize.observe(host);

        contextLossHandler = (event: Event) => {
          event.preventDefault();
          teardown();
          setSceneMode("unavailable");
        };
        renderer.domElement.addEventListener(
          "webglcontextlost",
          contextLossHandler,
        );

        setSceneMode("three");
      } catch {
        disposeScene();
        if (!disposed) setSceneMode("unavailable");
      }
    })();

    return () => {
      disposed = true;
      disposeScene();
    };
  }, [chapters, sceneActivated]);

  const onChapterKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + chapters.length) % chapters.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % chapters.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = chapters.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectChapter(nextIndex, true);
  };

  const onChapterClick = (event: MouseEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    selectChapter(index);
  };

  if (!chapters.length) return null;

  const activeChapter = chapters[selectedIndex] ?? chapters.at(-1);
  const chapterCount = chapters.length;
  const anchorCount = chapters.reduce(
    (count, chapter) => count + chapter.works.length,
    0,
  );

  return (
    <section className={styles.section} aria-labelledby="career-chapters-title">
      <header className={styles.heading}>
        <div>
          <p>Career Chapters</p>
          <h2 id="career-chapters-title">
            The work, in {chapterCount} {chapterCount === 1 ? "turn" : "turns"}.
          </h2>
        </div>
        <p>
          {anchorCount} {anchorCount === 1 ? "anchor" : "anchors"} from a larger
          public archive. Choose a chapter to see what moved forward.
        </p>
      </header>

      <div className={styles.chapterShell}>
        <div className={styles.chapterList}>
          {chapters.map((chapter, index) => {
            const selected = index === selectedIndex;
            return (
              <details
                className={styles.chapter}
                data-selected={selected ? "true" : "false"}
                key={chapter.id}
                open={selected}
                ref={(node) => {
                  detailRefs.current[index] = node;
                }}
              >
                <summary
                  onClick={(event) => onChapterClick(event, index)}
                  onKeyDown={(event) => onChapterKeyDown(event, index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.period}</small>
                  <i aria-hidden="true" />
                </summary>
                <div className={styles.panel} data-chapter-panel>
                  <p>{chapter.statement}</p>
                  <ol>
                    {chapter.works.map((work) => (
                      <li key={work.id}>
                        <Link
                          href={`/work/${work.slug}`}
                          title={work.canonicalTitle}
                        >
                          <span>
                            {work.year ?? chapter.period} · {work.role}
                          </span>
                          <strong>{work.label}</strong>
                          <i aria-hidden="true">↗</i>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            );
          })}
        </div>

        {canEnhanceWithThree ? (
          <div
            className={styles.visual}
            data-mode={sceneMode}
            aria-hidden="true"
          >
            <div className={styles.stage} ref={stageRef}>
              <div className={styles.staticSlabs}>
                {chapters.map((chapter, index) => (
                  <i
                    data-selected={index === selectedIndex ? "true" : "false"}
                    key={chapter.id}
                  />
                ))}
              </div>
              {sceneMode === "loading" ? (
                <span className={styles.loading}>Adding depth…</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <p className={styles.liveStatus} aria-live="polite">
        Selected: {activeChapter?.period} · {activeChapter?.title}
      </p>
    </section>
  );
}
