import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Studio exposes a provider-specific Spotify OAuth and publication flow", async () => {
  const controls = (
    await Promise.all([
      source("app/studio/ConnectorControls.tsx"),
      source("app/studio/connectors/ApiConnectorPanel.tsx"),
      source("app/studio/connectors/helpers.ts"),
      source("app/studio/connectors/SpotifyConnectorPanel.tsx"),
    ])
  ).join("\n");
  const page = await source("app/studio/page.tsx");

  assert.match(controls, /stream:\s*"Listen"[\s\S]*?title:\s*"Spotify"/);
  assert.match(
    controls,
    /startPath:\s*"\/api\/studio\/connectors\/spotify\/oauth\/start"/,
  );
  assert.match(
    controls,
    /safeAuthorizationUrl\([\s\S]*?accounts\.spotify\.com[\s\S]*?\/authorize/,
  );
  assert.match(controls, /\/api\/studio\/connectors\/spotify\/config/);
  assert.match(controls, /Publish Top Tracks publicly/);
  assert.match(controls, /acknowledgePublicDisplay:\s*publishTopTracks/);
  assert.match(controls, /Spotify-calculated affinity/);
  assert.match(controls, /Snapshot refresh due/);
  assert.match(controls, /Public cutoff/);
  assert.match(controls, /Reauthorize by/);
  assert.match(controls, /Access token refresh/);
  assert.match(controls, /local authorization[\s\S]*?stay on this machine/i);

  assert.match(page, /resolveSpotifyCallbackUrl/);
  assert.match(page, /spotifyCallbackUrl=\{spotifyCallbackUrl\}/);
});

test("OAuth resume preserves provider identity through Access", async () => {
  const resume = await source("app/studio/oauth-resume/page.tsx");

  assert.match(resume, /provider === "spotify"/);
  assert.match(resume, /isValidSpotifyOAuthState/);
  assert.match(resume, /completeSpotifyOAuth/);
  assert.match(resume, /connector=\$\{provider\}&result=/);
});

test("owner guide pins separate Spotify environments and forbids promotion", async () => {
  const guide = await source("docs/play-connections.md");

  assert.match(
    guide,
    /http:\/\/127\.0\.0\.1:3000\/api\/connectors\/spotify\/oauth\/callback/,
  );
  assert.match(
    guide,
    /https:\/\/anish-shah-work-in-public\.anish-shah-emails\.workers\.dev\/api\/connectors\/spotify\/oauth\/callback/,
  );
  assert.match(guide, /separate Spotify applications for local and production/i);
  assert.match(guide, /Spotify is deliberately excluded from the local-to-production transfer/i);
  assert.match(guide, /Top Tracks publicly/);
  assert.match(guide, /not a\s+play-count history/i);
});

test("Privacy describes Spotify data boundaries and visitor consent", async () => {
  const privacy = await source("app/privacy/page.tsx");

  assert.match(privacy, /Five deliberately different connections/);
  assert.match(privacy, /Spotify · Listen/);
  assert.match(privacy, /does not infer listening time, genre, trends, or a taste/);
  assert.match(privacy, /blocked until a visitor explicitly chooses to load it/);
  assert.match(privacy, /Spotify Developer Terms/);
});
