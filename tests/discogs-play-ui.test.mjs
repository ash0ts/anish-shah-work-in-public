import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

test("Collect is a lazy direct room route with a complete semantic fallback", async () => {
  const [screen, screens, discogs, page, direct] = await Promise.all([
    source("components/play/room-screens/CollectRoomScreen.tsx"),
    source("components/play/room-platform/room-screen-registry.ts"),
    source("components/play/DiscogsStream.tsx"),
    source("app/play/page.tsx"),
    source("app/play/[objectSlug]/page.tsx"),
  ]);

  assert.match(screens, /collect: \(\) => import\("\.\.\/room-screens\/CollectRoomScreen"\)/);
  assert.match(screen, /<DiscogsStream/);
  assert.match(screen, /routePath="\/play\/collect"/);
  assert.match(discogs, /loadConnector<DiscogsPublicSnapshot>\([\s\S]*?"discogs"/);
  assert.match(discogs, /new URLSearchParams\([\s\S]*?pageSize/);
  assert.match(direct, /collect: async \(query\)/);
  assert.match(direct, /ROOM_PROVIDER_ADAPTERS\.collect\(query\)/);
  assert.match(page, /permanentRedirect\(legacyObject\.route\)/);
  assert.match(
    page,
    /<RoomOverview[\s\S]*?fixture=\{fixture\}[\s\S]*?travelEnabled=\{travelAtlasEnabled\(\)\}/,
  );
});

test("Discogs uses a ruled shelf and an accessible pressing matrix", async () => {
  const [discogs, css] = await Promise.all([
    source("components/play/DiscogsStream.tsx"),
    source("components/play/StreamPresentation.module.css"),
  ]);

  assert.match(discogs, /Pressings and releases, kept distinct/);
  assert.match(discogs, /presentation === "crate"/);
  assert.match(discogs, /className=\{styles\.cratePanelHeading\}/);
  assert.doesNotMatch(discogs, /Inside the crate|In the crate/);
  assert.match(discogs, /SITE_COPY\.play\["view-overview"\]/);
  assert.match(discogs, /SITE_COPY\.play\["view-browse-all"\]/);
  assert.match(discogs, /physical items/);
  assert.match(discogs, /distinct releases/);
  assert.match(
    discogs,
    /role="region"[\s\S]*?<table>[\s\S]*?<caption[\s\S]*?<th scope="col">Format<\/th>/,
  );
  assert.match(discogs, /<th scope="row">\{format\}<\/th>/);
  assert.match(discogs, /Find a title or artist/);
  for (const label of ["Format", "Decade", "Sort", "Per page"]) {
    assert.match(discogs, new RegExp('label="' + label + '"'));
  }
  assert.match(discogs, /\[12, 24, 36\]/);
  assert.match(discogs, /https:\/\/www\.discogs\.com\/release\//);
  assert.match(
    discogs,
    /not affiliated with,\s+sponsored or endorsed by Discogs/,
  );
  assert.doesNotMatch(
    discogs,
    /<Image\b|<img\b|<canvas\b|<svg\b|from\s+["']three["']|autoplay|release\.(?:url|uri|image)/i,
  );

  assert.match(css, /\.discogsShelf\s*\{/);
  assert.match(css, /\.discogsMatrixScroll\s*\{[\s\S]*?overflow-x: auto/);
});

test("Studio exposes Discogs OAuth1 and an explicit publication gate", async () => {
  const [panel, sharedPanel, controls, page, privacy] = await Promise.all([
    source("app/studio/connectors/DiscogsConnectorPanel.tsx"),
    source("app/studio/connectors/ApiConnectorPanel.tsx"),
    source("app/studio/ConnectorControls.tsx"),
    source("app/studio/page.tsx"),
    source("app/privacy/page.tsx"),
  ]);

  assert.match(panel, /Consumer key/);
  assert.match(panel, /Consumer secret/);
  assert.match(panel, /id: "consumerKey"/);
  assert.match(panel, /secret: "consumerSecret"/);
  assert.match(panel, /showsAccessTokenExpiry: false/);
  assert.match(panel, /Publish physical collection publicly/);
  assert.match(panel, /acknowledgeNoncommercial/);
  assert.match(panel, /personal, noncommercial catalog/);
  assert.match(panel, /excluded from the production handoff/);
  assert.match(panel, /href="\/play\/collect"/);
  assert.match(
    sharedPanel,
    /\[oauthCredentialShape\.requestKeys\.id\]: credentialId\.trim\(\)/,
  );
  assert.match(
    sharedPanel,
    /isOAuthProvider && oauthCredentialShape\.showsAccessTokenExpiry/,
  );
  assert.match(sharedPanel, /Provider retry available/);
  assert.match(sharedPanel, /connectorBlocked \|\| retryBlocked/);
  assert.match(sharedPanel, /Retry after \$\{formatTimestamp\(retryNotBefore\)\}/);
  assert.match(controls, /case "discogs"/);
  assert.match(page, /resolveDiscogsCallbackUrl/);
  assert.match(page, /discogsCallbackUrl=\{discogsCallbackUrl\}/);
  assert.match(privacy, /Six connections and one owner-authored atlas/);
  assert.match(privacy, /Discogs · Collect/);
  assert.match(privacy, /unavailable six hours/i);
  assert.match(privacy, /Discogs API Terms of Use/);
});
