import { expect } from "@playwright/test";

export const ROOM_READY_TIMEOUT_MS = 15_000;

export async function roomReadinessDiagnostics(page) {
  try {
    return await page.evaluate(() => {
      const runtime = document.querySelector("[data-room-runtime]");
      const stage = document.querySelector("[data-room-poster-stage]");
      const loadingBoundary = document.querySelector(
        "[data-room-runtime-loading]",
      );
      const statusText = [...document.querySelectorAll('[role="status"]')]
        .map((element) => element.textContent?.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 8);
      const roomResources = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /Room(?:Runtime|Stage)|react-three|three(?:[.-]|$)/i.test(name))
        .map((name) => {
          try {
            return new URL(name).pathname;
          } catch {
            return name;
          }
        });

      return {
        path: window.location.pathname,
        documentReadyState: document.readyState,
        loadingBoundaryPresent: Boolean(loadingBoundary),
        runtime: runtime
          ? {
              ariaBusy: runtime.getAttribute("aria-busy"),
              ariaHidden: runtime.getAttribute("aria-hidden"),
              inert: runtime.hasAttribute("inert"),
              phase: runtime.getAttribute("data-room-transition-phase"),
              presenting: runtime.getAttribute("data-presenting"),
              ready: runtime.getAttribute("data-room-ready"),
              returning: runtime.getAttribute("data-returning"),
              visible: runtime.getClientRects().length > 0,
            }
          : null,
        stage: stage
          ? {
              hoveredObject: stage.getAttribute("data-room-hovered-object"),
              projection: stage.getAttribute("data-projection"),
              visible: stage.getClientRects().length > 0,
            }
          : null,
        canvasCount: document.querySelectorAll("canvas").length,
        statusText,
        roomResources,
      };
    });
  } catch (error) {
    return {
      path: page.url(),
      inspectionError:
        error instanceof Error ? error.message : "Unknown inspection error",
    };
  }
}

export async function expectRoomReady(
  page,
  { context = "room interaction", timeout = ROOM_READY_TIMEOUT_MS } = {},
) {
  const deadline = Date.now() + timeout;
  const room = page.getByRole("dialog", { name: "Interactive room" });

  try {
    await expect(
      room,
      `The interactive room should be ready before ${context}.`,
    ).toHaveAttribute("data-room-ready", "true", { timeout });

    await expect(
      room.getByText("Room ready", { exact: true }),
      "The semantic room status should agree with the runtime readiness state.",
    ).toBeVisible({ timeout: Math.max(1, deadline - Date.now()) });
  } catch (error) {
    const diagnostics = await roomReadinessDiagnostics(page);
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Interactive room readiness exceeded ${timeout}ms before ${context}.\n` +
        `${JSON.stringify(diagnostics, null, 2)}\n${cause}`,
      { cause: error },
    );
  }

  return room;
}
