import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the simulation ingress is gated and lazy-isolated from disabled Play", async () => {
  const [layout, page, control, overview, runtime, provider, registry, copy] = await Promise.all([
    source("app/play/layout.tsx"),
    source("app/play/page.tsx"),
    source("components/play/room-platform/RevealSimulationControl.tsx"),
    source("components/play/room-platform/RoomOverview.tsx"),
    source("components/play/room-platform/RoomRuntime.tsx"),
    source("components/play/room-platform/RoomExperienceProvider.tsx"),
    source("components/play/room-platform/room-registry.ts"),
    source("content/copy/pages/simulation.md"),
  ]);

  assert.match(layout, /simulationExperienceVisible\(\)/);
  assert.match(layout, /simulationEnabled=\{simulationExperienceVisible\(\)\}/);
  assert.match(page, /simulationEnabled=\{simulationExperienceVisible\(\)\}/);
  assert.match(overview, /\{simulationEnabled \? \(/);
  assert.match(runtime, /lazy\(\(\) =>[\s\S]*import\("\.\/RevealSimulationControl"\)/);
  assert.match(runtime, /\{room\.simulationEnabled \? \(/);
  assert.doesNotMatch(provider, /data-simulation-reveal-overlay|memoryWafer/);
  assert.match(control, /<Link/);
  assert.match(control, /href="\/simulation"/);
  assert.match(control, /prefetch=\{false\}/);
  assert.match(control, /SITE_COPY\.simulation\["ingress-cta"\]/);
  assert.match(copy, /## ingress-cta\s+Reveal the simulation/u);
  assert.match(control, /event\.preventDefault\(\)/);
  assert.match(control, /event\.metaKey/);
  assert.match(control, /event\.ctrlKey/);
  assert.equal((overview.match(/<RevealSimulationControl/g) ?? []).length, 1);
  assert.equal((runtime.match(/<LazyRevealSimulationControl/g) ?? []).length, 1);
  assert.ok(
    overview.indexOf("<RevealSimulationControl") <
      overview.indexOf("data-room-static-stage"),
    "The overview link must sit outside the static room click area.",
  );
  assert.ok(
    runtime.indexOf("<LazyRevealSimulationControl") <
      runtime.lastIndexOf("data-room-stage-shell"),
    "The live link must sit outside the canvas click area.",
  );
  assert.doesNotMatch(registry, /id: "simulation"|route: "\/simulation"/);
});

test("the robot and memory-wafer reveal is bounded, cancellable, and reduced-motion safe", async () => {
  const [control, copy] = await Promise.all([
    source("components/play/room-platform/RevealSimulationControl.tsx"),
    source("content/copy/pages/simulation.md"),
  ]);
  assert.match(control, /if \(!transitioning \|\| navigationStarted\.current\) return/);
  assert.match(control, /data-simulation-reveal-overlay/);
  assert.match(control, /data-simulation-robot/);
  assert.match(control, /data-simulation-memory-wafer/);
  assert.match(control, /SITE_COPY\.simulation\["transition-cancel-cta"\]/);
  assert.match(copy, /## transition-cancel-cta\s+Cancel dive/u);
  assert.match(control, /prefers-reduced-motion: reduce/);
  assert.match(control, /setTimeout\(navigate, 180\)/);
  assert.match(control, /setTimeout\(navigate, 940\)/);
  assert.match(
    control,
    /\[data-room-runtime\] \[data-room-stage-shell\][\s\S]*\[data-room-static-stage\]/,
  );
  assert.match(control, /router\.push\("\/simulation", \{ scroll: false \}\)/);
  assert.match(control, /playCue\("simulation-reveal"\)/);
  assert.match(control, /\[data-room-overview\], \[data-room-runtime\]/);
  assert.match(control, /document\.documentElement\.style\.overflow = "hidden"/);
  // Cancellation must also restore the room's transformed inline styles.
  // Browser coverage checks the restored opacity, focus, and Escape ownership.
  assert.match(control, /animation\.revert\(\)/);
  assert.match(control, /clearTimeout\(completionTimer\.current\)/);
});
