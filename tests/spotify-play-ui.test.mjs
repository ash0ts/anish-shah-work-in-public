import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const spotifySourceUrls = [
  "../components/SpotifyStream.tsx",
  "../components/spotify/model.ts",
  "../components/spotify/SpotifyRankedGroove.tsx",
  "../components/spotify/SpotifyTrackPresentation.tsx",
  "../components/spotify/SpotifyFallback.tsx",
].map((file) => new URL(file, import.meta.url));
const spotifyCssUrl = new URL(
  "../components/SpotifyStream.module.css",
  import.meta.url,
);
const playPageUrl = new URL(
  "../components/play/room-screens/ListenRoomScreen.tsx",
  import.meta.url,
);

async function spotifySource() {
  return (await Promise.all(spotifySourceUrls.map((url) => readFile(url, "utf8")))).join(
    "\n",
  );
}

test("Spotify stays isolated to its lazy room screen and uses only ordinal Top Tracks fields", async () => {
  const [spotify, screenRegistry, screen] = await Promise.all([
    spotifySource(),
    readFile(new URL("../components/play/room-platform/room-screen-registry.ts", import.meta.url), "utf8"),
    readFile(playPageUrl, "utf8"),
  ]);

  assert.match(
    screenRegistry,
    /listen: \(\) => import\("\.\.\/room-screens\/ListenRoomScreen"\)/,
  );
  assert.match(screen, /<SpotifyStream fixture=\{fixture\} initialState=\{initialState\}/);
  assert.match(spotify, /fetch\("\/api\/connectors\/spotify"/);
  for (const range of ["short_term", "medium_term", "long_term"]) {
    assert.match(spotify, new RegExp(`id: "${range}"`));
  }
  assert.match(spotify, /\.tracks\.slice\(0, 12\)/);
  assert.match(spotify, /Spotify-calculated affinity; not play counts/);
  assert.doesNotMatch(
    spotify,
    /\b(?:popularity|danceability|energy|tempo|genre|playCount)\b|audio[_ -]?features|rank change|listening (?:time|minutes)/i,
  );
});

test("Ranked Groove has semantic keyboard and mobile equivalents", async () => {
  const [spotify, css] = await Promise.all([
    spotifySource(),
    readFile(spotifyCssUrl, "utf8"),
  ]);

  assert.match(
    spotify,
    /<svg[\s\S]*?aria-hidden="true"[\s\S]*?className=\{styles\.groove\}/,
  );
  assert.match(
    spotify,
    /<ol[\s\S]*?className=\{styles\.grooveControls\}[\s\S]*?Spotify Top Tracks in returned order/,
  );
  assert.match(spotify, /aria-pressed=\{selected\}/);
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
    assert.match(spotify, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(
    spotify,
    /<ol className=\{styles\.rankRail\} aria-label="Spotify Top Tracks in returned order"/,
  );
  assert.match(css, /\.grooveControls button\s*\{[\s\S]*?width: 3rem[\s\S]*?height: 3rem/);
  assert.match(css, /\.grooveControls button:focus-visible\s*\{/);
  assert.match(css, /@media \(max-width: 60rem\)[\s\S]*?\.grooveDisc\s*\{[\s\S]*?display: none/);
  assert.match(css, /@media \(max-width: 60rem\)[\s\S]*?\.rankRail\s*\{[\s\S]*?display: grid/);
  assert.match(css, /@media \(max-width: 339px\)[\s\S]*?\.covers > ol[\s\S]*?grid-template-columns: 1fr/);
  assert.doesNotMatch(spotify, /<svg[\s\S]*?role="button"/);
});

test("Spotify playback is consent-gated, official, and non-reactive", async () => {
  const spotify = await spotifySource();

  assert.match(
    spotify,
    /playerTrack \? \([\s\S]*?playerConsent \? \([\s\S]*?<SpotifyPlayer[\s\S]*?<SpotifyTrackConsent/,
  );
  assert.match(spotify, /Load Spotify player/);
  assert.match(spotify, /Listen on Spotify/);
  assert.match(spotify, /className=\{styles\.selectionAnnouncement\}[\s\S]*?selected\./);
  assert.doesNotMatch(spotify, /className=\{styles\.inspector\} aria-live=/);
  assert.match(spotify, /showEmbed \? \([\s\S]*?<iframe/);
  assert.match(spotify, /https:\/\/open\.spotify\.com\/embed\/\$\{kind\}/);
  assert.match(spotify, /requestAnimationFrame\(\(\) => playerInvoker\.current\?\.focus\(\)\)/);
  assert.match(spotify, /const selectView = [\s\S]*?closePlayer\(false\)[\s\S]*?setView\(next\)/);
  assert.match(spotify, /\/spotify-full-logo-black\.svg/);
  assert.doesNotMatch(
    spotify,
    /<audio\b|AudioContext|webkitAudioContext|WebGL|from\s+["']three["']|autoplay;|preview_url/i,
  );
});

test("Play supplies a server-rendered Spotify no-JavaScript list", async () => {
  const [screen, direct, foundation] = await Promise.all([
    readFile(playPageUrl, "utf8"),
    readFile(new URL("../app/play/[objectSlug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/play-screen-foundation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(direct, /ROOM_PROVIDER_ADAPTERS\.listen\(query\)/);
  assert.match(foundation, /getSpotifyScreenFoundation/);
  assert.match(foundation, /getPublicConnectorSnapshot\("spotify"\)/);
  assert.match(foundation, /getSpotifyPublicFallback\(\)/);
  assert.match(screen, /<SpotifyStream fixture=\{fixture\} initialState=\{initialState\}/);
});
