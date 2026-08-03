import type { PreviewFixtureScenario } from "../connector-model";

const PREVIEW_FIXTURE_SCENARIOS = new Set<PreviewFixtureScenario>([
  "ready",
  "unavailable",
  "empty",
  "stale",
  "long-title",
  "missing-artwork",
  "maximum-density",
]);

export function previewFixtureFromSearch(
  search: string,
): PreviewFixtureScenario | undefined {
  const candidate = new URLSearchParams(search).get("fixture");
  return candidate &&
    PREVIEW_FIXTURE_SCENARIOS.has(candidate as PreviewFixtureScenario)
    ? (candidate as PreviewFixtureScenario)
    : undefined;
}

export function routeWithPreviewFixture(
  route: string,
  fixture?: PreviewFixtureScenario,
): string {
  return fixture
    ? `${route}?fixture=${encodeURIComponent(fixture)}`
    : route;
}
