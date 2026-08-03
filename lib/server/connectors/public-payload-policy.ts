import { validatePublicProjection } from "../editorial-policy";
import { isStoredArtworkRef } from "./artwork";
import type { ConnectorProvider } from "./types";

const PROFILE_POLICIES: Record<
  ConnectorProvider,
  { hosts: ReadonlySet<string>; path: RegExp }
> = {
  myanimelist: {
    hosts: new Set(["myanimelist.net", "www.myanimelist.net"]),
    path: /^\/profile\/[a-z0-9_-]{1,64}\/?$/i,
  },
  hardcover: {
    hosts: new Set(["hardcover.app", "www.hardcover.app"]),
    path: /^\/@[a-z0-9_-]{1,64}\/?$/i,
  },
  spotify: {
    hosts: new Set(["open.spotify.com"]),
    path: /^\/user\/[a-z0-9._~-]{1,128}\/?$/i,
  },
  discogs: {
    hosts: new Set(["discogs.com", "www.discogs.com"]),
    path: /^\/user\/[a-z0-9._~-]{1,64}\/collection\/?$/i,
  },
  steam: {
    hosts: new Set(["steamcommunity.com", "www.steamcommunity.com"]),
    path: /^\/profiles\/\d{17}\/?$/,
  },
};

const FORBIDDEN_CREDENTIAL_FIELDS = new Set([
  "apikey",
  "authorization",
  "ciphertext",
  "credential",
  "iv",
  "key",
  "password",
  "refreshtoken",
  "secret",
  "steamid",
  "steamid64",
  "token",
  "accesstoken",
]);

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TIME_RANGES = [
  "short_term",
  "medium_term",
  "long_term",
] as const;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DECIMAL_ID = /^[1-9]\d{0,24}$/;
const PARTIAL_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const DISCOGS_FORMATS = [
  "Box set",
  "Vinyl",
  "CD",
  "Cassette",
  "Other",
] as const;
const DISCOGS_DECADE = /^(?:\d{4}s|Undated)$/;

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function boundedPublicString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validNullableIsoTimestamp(value: unknown): boolean {
  return value === null || validIsoTimestamp(value);
}

function validInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validStoredArtwork(value: unknown, kind: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const artwork = value as Record<string, unknown>;
  const required = kind === "steam-icon" ? ["kind", "appId", "hash"] : ["kind", "assetKey"];
  return hasOnlyKeys(artwork, required) && isStoredArtworkRef(artwork) && artwork.kind === kind;
}

function validCountSeries(value: unknown, maximumEntries: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumEntries &&
    value.every((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }
      const record = entry as Record<string, unknown>;
      return (
        hasOnlyKeys(record, ["label", "count"]) &&
        boundedPublicString(record.label, 128) &&
        validInteger(record.count, 0, 20_000)
      );
    })
  );
}

function validMalItem(value: unknown, recent: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const required = recent
    ? ["id", "title", "status", "score", "episodesWatched", "updatedAt"]
    : [
        "id",
        "title",
        "startDate",
        "releaseYear",
        "genres",
        "status",
        "score",
        "episodesWatched",
        "updatedAt",
      ];
  if (!hasOnlyKeys(item, required, recent ? [] : ["artwork"])) return false;
  if (
    typeof item.id !== "string" ||
    !DECIMAL_ID.test(item.id) ||
    !boundedPublicString(item.title, 512) ||
    !["Watching", "Completed", "On hold", "Dropped", "Plan to watch", "Other"].includes(String(item.status)) ||
    !(item.score === null || validInteger(item.score, 0, 10)) ||
    !(item.episodesWatched === null || validInteger(item.episodesWatched, 0, 1_000_000)) ||
    !validNullableIsoTimestamp(item.updatedAt)
  ) {
    return false;
  }
  if (recent) return true;
  return (
    (item.startDate === null ||
      (typeof item.startDate === "string" && PARTIAL_DATE.test(item.startDate))) &&
    (item.releaseYear === null || validInteger(item.releaseYear, 1_000, 9_999)) &&
    Array.isArray(item.genres) &&
    item.genres.length <= 64 &&
    item.genres.every((genre) => boundedPublicString(genre, 128)) &&
    new Set(item.genres).size === item.genres.length &&
    (!Object.hasOwn(item, "artwork") || validStoredArtwork(item.artwork, "mal-cover"))
  );
}

function validMyAnimeListPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider", "snapshotVersion", "profileUrl", "coverage", "status",
      "genres", "eras", "scores", "recent", "library", "syncedAt", "freshUntil",
    ]) ||
    payload.provider !== "myanimelist" ||
    payload.snapshotVersion !== 3 ||
    payload.coverage !== "Complete anime library at sync" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    !validCountSeries(payload.status, 16) ||
    !validCountSeries(payload.genres, 512) ||
    !validCountSeries(payload.eras, 128) ||
    !validCountSeries(payload.scores, 16) ||
    !Array.isArray(payload.recent) ||
    payload.recent.length > 12 ||
    !payload.recent.every((item) => validMalItem(item, true)) ||
    !Array.isArray(payload.library) ||
    payload.library.length > 5_000 ||
    !payload.library.every((item) => validMalItem(item, false))
  ) {
    return false;
  }
  const ids = payload.library.map((item) => (item as Record<string, unknown>).id);
  const idSet = new Set(ids);
  return (
    idSet.size === ids.length &&
    payload.recent.every((item) =>
      idSet.has((item as Record<string, unknown>).id),
    )
  );
}

function validHardcoverItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    hasOnlyKeys(
      item,
      ["id", "title", "slug", "status", "rating", "updatedAt"],
      ["artwork"],
    ) &&
    typeof item.id === "string" &&
    DECIMAL_ID.test(item.id) &&
    boundedPublicString(item.title, 512) &&
    (item.slug === null || boundedPublicString(item.slug, 240)) &&
    ["Want to read", "Currently reading", "Read", "Did not finish", "Other"].includes(String(item.status)) &&
    (item.rating === null || validFiniteNumber(item.rating, 0, 5)) &&
    validNullableIsoTimestamp(item.updatedAt) &&
    (!Object.hasOwn(item, "artwork") || validStoredArtwork(item.artwork, "hardcover-cover"))
  );
}

function validHardcoverPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider", "snapshotVersion", "profileUrl", "coverage", "status",
      "ratings", "recent", "library", "syncedAt", "freshUntil",
    ]) ||
    payload.provider !== "hardcover" ||
    payload.snapshotVersion !== 3 ||
    payload.coverage !== "Complete book library at sync" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    !validCountSeries(payload.status, 16) ||
    !validCountSeries(payload.ratings, 64) ||
    !Array.isArray(payload.recent) ||
    payload.recent.length > 12 ||
    !payload.recent.every(validHardcoverItem) ||
    !Array.isArray(payload.library) ||
    payload.library.length > 5_000 ||
    !payload.library.every(validHardcoverItem)
  ) {
    return false;
  }
  const ids = payload.library.map((item) => (item as Record<string, unknown>).id);
  const idSet = new Set(ids);
  return (
    idSet.size === ids.length &&
    payload.recent.every((item) =>
      idSet.has((item as Record<string, unknown>).id),
    )
  );
}

function validSteamSummary(value: unknown, recent: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const numericKeys = recent
    ? ["recentHoursRounded", "totalHoursRounded"]
    : ["hoursRounded"];
  return (
    hasOnlyKeys(item, ["appId", "title", ...numericKeys]) &&
    typeof item.appId === "string" &&
    DECIMAL_ID.test(item.appId) &&
    boundedPublicString(item.title, 512) &&
    numericKeys.every((key) => validInteger(item[key], 0, 10_000_000))
  );
}

function validSteamLibraryItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    hasOnlyKeys(
      item,
      ["appId", "title", "played", "recentlyPlayed", "totalHoursRounded", "recentHoursRounded"],
      ["artwork"],
    ) &&
    typeof item.appId === "string" &&
    DECIMAL_ID.test(item.appId) &&
    boundedPublicString(item.title, 512) &&
    typeof item.played === "boolean" &&
    typeof item.recentlyPlayed === "boolean" &&
    validInteger(item.totalHoursRounded, 0, 10_000_000) &&
    validInteger(item.recentHoursRounded, 0, 10_000_000) &&
    (!Object.hasOwn(item, "artwork") ||
      (validStoredArtwork(item.artwork, "steam-icon") &&
        (item.artwork as Record<string, unknown>).appId === item.appId))
  );
}

function validSteamPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider", "snapshotVersion", "profileUrl", "coverage", "totals",
      "topPlayed", "recent", "playtime", "library", "syncedAt", "freshUntil",
    ]) ||
    payload.provider !== "steam" ||
    payload.snapshotVersion !== 3 ||
    payload.coverage !== "Complete public Steam library snapshot" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    typeof payload.totals !== "object" ||
    payload.totals === null ||
    Array.isArray(payload.totals)
  ) {
    return false;
  }
  const totals = payload.totals as Record<string, unknown>;
  if (
    !hasOnlyKeys(totals, ["publicGameCount", "playedGameCount", "totalHoursRounded"]) ||
    !validInteger(totals.publicGameCount, 0, 20_000) ||
    !validInteger(totals.playedGameCount, 0, 20_000) ||
    !validInteger(totals.totalHoursRounded, 0, 10_000_000) ||
    !Array.isArray(payload.topPlayed) ||
    payload.topPlayed.length > 8 ||
    !payload.topPlayed.every((item) => validSteamSummary(item, false)) ||
    !Array.isArray(payload.recent) ||
    payload.recent.length > 8 ||
    !payload.recent.every((item) => validSteamSummary(item, true)) ||
    !validCountSeries(payload.playtime, 5) ||
    !Array.isArray(payload.library) ||
    payload.library.length > 20_000 ||
    !payload.library.every(validSteamLibraryItem)
  ) {
    return false;
  }
  const library = payload.library as Array<Record<string, unknown>>;
  const ids = library.map((item) => item.appId);
  const idSet = new Set(ids);
  const playtime = payload.playtime as Array<Record<string, unknown>>;
  const expectedPlaytimeLabels = [
    "Unplayed",
    "Under 2h",
    "2–10h",
    "10–50h",
    "50h+",
  ];
  return (
    idSet.size === ids.length &&
    totals.publicGameCount === library.length &&
    totals.playedGameCount === library.filter((item) => item.played).length &&
    playtime.length === expectedPlaytimeLabels.length &&
    playtime.every(
      (entry, index) => entry.label === expectedPlaytimeLabels[index],
    ) &&
    playtime.reduce((total, entry) => total + Number(entry.count), 0) ===
      library.length &&
    payload.topPlayed.every((item) =>
      idSet.has((item as Record<string, unknown>).appId),
    ) &&
    payload.recent.every((item) =>
      idSet.has((item as Record<string, unknown>).appId),
    )
  );
}

function validSpotifyTrack(value: unknown, expectedPosition: number): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const track = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(
      track,
      ["id", "position", "title", "artists", "album", "durationMs", "explicit"],
    ) ||
    typeof track.id !== "string" ||
    !SPOTIFY_ID.test(track.id) ||
    track.position !== expectedPosition ||
    !boundedPublicString(track.title, 512) ||
    !Array.isArray(track.artists) ||
    track.artists.length < 1 ||
    track.artists.length > 32 ||
    typeof track.durationMs !== "number" ||
    !Number.isSafeInteger(track.durationMs) ||
    track.durationMs < 1 ||
    track.durationMs > 24 * 60 * 60 * 1000 ||
    typeof track.explicit !== "boolean"
  ) {
    return false;
  }
  if (
    !track.artists.every((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const artist = value as Record<string, unknown>;
      return (
        hasOnlyKeys(artist, ["id", "name"]) &&
        typeof artist.id === "string" &&
        SPOTIFY_ID.test(artist.id) &&
        boundedPublicString(artist.name, 512)
      );
    })
  ) {
    return false;
  }
  if (
    typeof track.album !== "object" ||
    track.album === null ||
    Array.isArray(track.album)
  ) {
    return false;
  }
  const album = track.album as Record<string, unknown>;
  return (
    hasOnlyKeys(album, ["id", "title", "releaseYear"], ["artwork"]) &&
    typeof album.id === "string" &&
    SPOTIFY_ID.test(album.id) &&
    boundedPublicString(album.title, 512) &&
    (album.releaseYear === null ||
      (typeof album.releaseYear === "number" &&
        Number.isSafeInteger(album.releaseYear) &&
        album.releaseYear >= 1000 &&
        album.releaseYear <= 9999)) &&
    (!Object.hasOwn(album, "artwork") ||
      (isStoredArtworkRef(album.artwork) &&
        album.artwork.kind === "spotify-cover"))
  );
}

function validSpotifyPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider",
      "snapshotVersion",
      "profileUrl",
      "coverage",
      "windows",
      "syncedAt",
      "freshUntil",
    ]) ||
    payload.provider !== "spotify" ||
    payload.snapshotVersion !== 1 ||
    payload.coverage !== "Spotify-calculated affinity; not play counts" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    typeof payload.windows !== "object" ||
    payload.windows === null ||
    Array.isArray(payload.windows)
  ) {
    return false;
  }
  const windows = payload.windows as Record<string, unknown>;
  if (!hasOnlyKeys(windows, SPOTIFY_TIME_RANGES)) return false;
  return SPOTIFY_TIME_RANGES.every((range) => {
    const value = windows[range];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const window = value as Record<string, unknown>;
    if (!hasOnlyKeys(window, ["tracks"]) || !Array.isArray(window.tracks)) {
      return false;
    }
    if (window.tracks.length > 12) return false;
    const seen = new Set<string>();
    return window.tracks.every((track, index) => {
      if (!validSpotifyTrack(track, index + 1)) return false;
      const id = (track as Record<string, unknown>).id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
}

function validDiscogsRelease(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const release = value as Record<string, unknown>;
  return (
    hasOnlyKeys(release, [
      "releaseId",
      "title",
      "artists",
      "releaseYear",
      "format",
      "copyCount",
    ]) &&
    typeof release.releaseId === "string" &&
    DECIMAL_ID.test(release.releaseId) &&
    boundedPublicString(release.title, 512) &&
    Array.isArray(release.artists) &&
    release.artists.length >= 1 &&
    release.artists.length <= 64 &&
    release.artists.every((artist) => boundedPublicString(artist, 512)) &&
    new Set(release.artists).size === release.artists.length &&
    (release.releaseYear === null ||
      validInteger(release.releaseYear, 1_000, 9_999)) &&
    DISCOGS_FORMATS.includes(
      release.format as (typeof DISCOGS_FORMATS)[number],
    ) &&
    validInteger(release.copyCount, 1, 5_000)
  );
}

function validDiscogsMatrix(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 5_000 &&
    value.every((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry)
      ) {
        return false;
      }
      const record = entry as Record<string, unknown>;
      return (
        hasOnlyKeys(record, ["format", "decade", "count"]) &&
        DISCOGS_FORMATS.includes(
          record.format as (typeof DISCOGS_FORMATS)[number],
        ) &&
        typeof record.decade === "string" &&
        DISCOGS_DECADE.test(record.decade) &&
        validInteger(record.count, 1, 5_000)
      );
    })
  );
}

function discogsDecade(year: unknown): string {
  return typeof year === "number"
    ? `${Math.floor(year / 10) * 10}s`
    : "Undated";
}

function validDiscogsPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider",
      "snapshotVersion",
      "profileUrl",
      "coverage",
      "totals",
      "formats",
      "decades",
      "formatDecadeMatrix",
      "library",
      "syncedAt",
      "freshUntil",
    ]) ||
    payload.provider !== "discogs" ||
    payload.snapshotVersion !== 1 ||
    payload.coverage !==
      "Physical releases returned from the public Discogs collection" ||
    typeof payload.profileUrl !== "string" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    typeof payload.totals !== "object" ||
    payload.totals === null ||
    Array.isArray(payload.totals) ||
    !validCountSeries(payload.formats, DISCOGS_FORMATS.length) ||
    !validCountSeries(payload.decades, 1_000) ||
    !validDiscogsMatrix(payload.formatDecadeMatrix) ||
    !Array.isArray(payload.library) ||
    payload.library.length > 5_000 ||
    !payload.library.every(validDiscogsRelease)
  ) {
    return false;
  }

  const totals = payload.totals as Record<string, unknown>;
  if (
    !hasOnlyKeys(totals, ["physicalItems", "distinctReleases"]) ||
    !validInteger(totals.physicalItems, 0, 5_000) ||
    !validInteger(totals.distinctReleases, 0, 5_000)
  ) {
    return false;
  }
  const library = payload.library as Array<Record<string, unknown>>;
  const releaseIds = library.map((release) => release.releaseId);
  if (
    new Set(releaseIds).size !== releaseIds.length ||
    totals.distinctReleases !== library.length ||
    totals.physicalItems !==
      library.reduce((count, release) => count + Number(release.copyCount), 0)
  ) {
    return false;
  }

  const formats = payload.formats as Array<Record<string, unknown>>;
  if (
    formats.length !== DISCOGS_FORMATS.length ||
    formats.some((entry, index) => entry.label !== DISCOGS_FORMATS[index])
  ) {
    return false;
  }
  const expectedFormats = new Map<string, number>(
    DISCOGS_FORMATS.map((format) => [format, 0]),
  );
  const expectedDecades = new Map<string, number>();
  const expectedMatrix = new Map<string, number>();
  for (const release of library) {
    const copyCount = Number(release.copyCount);
    const format = String(release.format);
    const decade = discogsDecade(release.releaseYear);
    expectedFormats.set(format, (expectedFormats.get(format) ?? 0) + copyCount);
    expectedDecades.set(decade, (expectedDecades.get(decade) ?? 0) + copyCount);
    const matrixKey = `${format}\u0000${decade}`;
    expectedMatrix.set(
      matrixKey,
      (expectedMatrix.get(matrixKey) ?? 0) + copyCount,
    );
  }
  if (
    formats.some(
      (entry) =>
        entry.count !== expectedFormats.get(String(entry.label)),
    )
  ) {
    return false;
  }

  const decades = payload.decades as Array<Record<string, unknown>>;
  const decadeLabels = decades.map((entry) => entry.label);
  if (
    new Set(decadeLabels).size !== decadeLabels.length ||
    decades.length !== expectedDecades.size ||
    decades.some(
      (entry) =>
        typeof entry.label !== "string" ||
        !DISCOGS_DECADE.test(entry.label) ||
        entry.count !== expectedDecades.get(entry.label),
    )
  ) {
    return false;
  }

  const matrix = payload.formatDecadeMatrix as Array<Record<string, unknown>>;
  const matrixKeys = matrix.map(
    (entry) => `${entry.format}\u0000${entry.decade}`,
  );
  return (
    new Set(matrixKeys).size === matrixKeys.length &&
    matrix.length === expectedMatrix.size &&
    matrix.every(
      (entry, index) =>
        entry.count === expectedMatrix.get(matrixKeys[index]),
    )
  );
}

export function normalizeConnectorProfileUrl(
  provider: ConnectorProvider,
  value: string | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const policy = PROFILE_POLICIES[provider];
  if (
    url.protocol !== "https:" ||
    !policy.hosts.has(url.hostname.toLocaleLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !policy.path.test(url.pathname)
  ) {
    return null;
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function hasForbiddenCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenCredentialField);
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      FORBIDDEN_CREDENTIAL_FIELDS.has(
        key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase(),
      ) || hasForbiddenCredentialField(child),
  );
}

function hasUnexpectedUrlField(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlField(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => {
      const childPath = `${path}.${key}`;
      if (/url$|uri$|image$/i.test(key)) {
        return !(
          path === "payload" &&
          key === "profileUrl" &&
          (child === null ||
            (typeof child === "string" &&
              normalizeConnectorProfileUrl(provider, child) === child))
        );
      }
      return hasUnexpectedUrlField(child, provider, childPath);
    },
  );
}

function hasUnexpectedUrlText(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (typeof value === "string") {
    if (!/(?:https?|file):\/\//i.test(value)) return false;
    return !(
      path === "payload.profileUrl" &&
      normalizeConnectorProfileUrl(provider, value) === value
    );
  }
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlText(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    hasUnexpectedUrlText(child, provider, `${path}.${key}`),
  );
}

export function validateConnectorPublicPayload(
  provider: ConnectorProvider,
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const exactSchemaValid =
    provider === "myanimelist"
      ? validMyAnimeListPayload(payload)
      : provider === "hardcover"
        ? validHardcoverPayload(payload)
        : provider === "steam"
          ? validSteamPayload(payload)
          : provider === "spotify"
            ? validSpotifyPayload(payload)
            : validDiscogsPayload(payload);
  return (
    payload.provider === provider &&
    exactSchemaValid &&
    Object.hasOwn(payload, "profileUrl") &&
    (payload.profileUrl === null ||
      (typeof payload.profileUrl === "string" &&
        normalizeConnectorProfileUrl(provider, payload.profileUrl) ===
          payload.profileUrl)) &&
    !hasForbiddenCredentialField(payload) &&
    !hasUnexpectedUrlField(payload, provider) &&
    !hasUnexpectedUrlText(payload, provider) &&
    validatePublicProjection(payload, `connector:${provider}`).ok
  );
}

export function parseStoredConnectorPublicPayload(
  provider: ConnectorProvider,
  value: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return validateConnectorPublicPayload(provider, parsed) ? parsed : null;
  } catch {
    return null;
  }
}
