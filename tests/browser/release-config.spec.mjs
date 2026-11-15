import { test, expect } from "@playwright/test";

test("candidate feature configuration controls route availability", async ({ request }) => {
  const simulationMode = process.env.BROWSER_SIMULATION_EXPERIENCE_MODE || "disabled";
  const travelMode = process.env.BROWSER_TRAVEL_ATLAS_MODE || "atlas-v1";
  expect((await request.get("/simulation")).status()).toBe(simulationMode === "disabled" ? 404 : 200);
  expect((await request.get("/play/travel?fixture=ready")).status()).toBe(travelMode === "disabled" ? 404 : 200);
  if (simulationMode !== "campaign-v1") {
    expect((await request.post("/api/simulation/session", { data: {} })).status()).toBe(404);
  }
});
