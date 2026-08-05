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
        .filter((name) =>
          /Room(?:Runtime|Stage)|PocketRoom|react-three|three(?:[.-]|$)/i.test(
            name,
          ),
        )
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
              pocketEntryPhase: runtime.getAttribute("data-pocket-entry-phase"),
              presenting: runtime.getAttribute("data-presenting"),
              ready: runtime.getAttribute("data-room-ready"),
              returning: runtime.getAttribute("data-returning"),
              tier: runtime.getAttribute("data-room-presentation-tier"),
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
  {
    context = "room interaction",
    expectedTier,
    timeout = ROOM_READY_TIMEOUT_MS,
  } = {},
) {
  const deadline = Date.now() + timeout;
  const room = page.getByRole("dialog", { name: "Interactive room" });

  try {
    if (expectedTier) {
      await expect(
        room,
        `The room should use the ${expectedTier} presentation before ${context}.`,
      ).toHaveAttribute("data-room-presentation-tier", expectedTier, {
        timeout,
      });
    }

    await expect(
      room,
      `The interactive room should be ready before ${context}.`,
    ).toHaveAttribute("data-room-ready", "true", {
      timeout: Math.max(1, deadline - Date.now()),
    });

    await expect(
      room.locator("[data-room-boot-status]"),
      "The visible boot status should agree with the runtime readiness state.",
    ).toHaveText("Room ready", {
      timeout: Math.max(1, deadline - Date.now()),
    });
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
