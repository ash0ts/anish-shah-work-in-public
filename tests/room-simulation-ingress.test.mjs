import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the simulation ingress is a server-gated semantic link in both room modes", async () => {
  const [layout, control, overview, runtime, registry] = await Promise.all([
    source("app/play/layout.tsx"),
    source("components/play/room-platform/RevealSimulationControl.tsx"),
    source("components/play/room-platform/RoomOverview.tsx"),
    source("components/play/room-platform/RoomRuntime.tsx"),
    source("components/play/room-platform/room-registry.ts"),
  ]);

  assert.match(layout, /simulationExperienceEnabled\(\)/);
  assert.match(layout, /simulationEnabled=\{simulationExperienceEnabled\(\)\}/);
  assert.match(control, /if \(!room\.simulationEnabled\) return null/);
  assert.match(control, /<Link/);
  assert.match(control, /href="\/simulation"/);
  assert.match(control, /prefetch=\{false\}/);
  assert.match(control, />\s*REVEAL THE SIMULATION\s*<\/Link>/);
  assert.match(control, /event\.preventDefault\(\)/);
  assert.match(control, /event\.metaKey/);
  assert.match(control, /event\.ctrlKey/);
  assert.equal((overview.match(/<RevealSimulationControl/g) ?? []).length, 1);
  assert.equal((runtime.match(/<RevealSimulationControl/g) ?? []).length, 1);
  assert.ok(
    overview.indexOf("<RevealSimulationControl") <
      overview.indexOf("data-room-static-stage"),
    "The overview link must sit outside the static room click area.",
  );
  assert.ok(
    runtime.indexOf("<RevealSimulationControl") <
      runtime.indexOf("data-room-stage-shell"),
    "The live link must sit outside the canvas click area.",
  );
  assert.doesNotMatch(registry, /id: "simulation"|route: "\/simulation"/);
});

test("the robot and memory-wafer reveal is bounded, cancellable, and reduced-motion safe", async () => {
  const provider = await source(
    "components/play/room-platform/RoomExperienceProvider.tsx",
  );
  assert.match(provider, /if \(!simulationEnabled \|\| simulationTransitioning\) return/);
  assert.match(provider, /data-simulation-reveal-overlay/);
  assert.match(provider, /data-simulation-robot/);
  assert.match(provider, /data-simulation-memory-wafer/);
  assert.match(provider, /Cancel dive/);
  assert.match(provider, /prefers-reduced-motion: reduce/);
  assert.match(provider, /guaranteeTransitionCompletion\(240, epoch, navigate\)/);
  assert.match(provider, /guaranteeTransitionCompletion\(940, epoch, navigate\)/);
  assert.match(provider, /router\.push\("\/simulation", \{ scroll: false \}\)/);
  assert.match(provider, /focusAfterPaint\("\[data-reveal-simulation\]"\)/);
  assert.match(provider, /playCue\("simulation-reveal"\)/);
  assert.match(provider, /\[data-room-overview\], body > \.skip-link/);
  assert.match(provider, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.doesNotMatch(provider, /setTimeout\(/);
});
