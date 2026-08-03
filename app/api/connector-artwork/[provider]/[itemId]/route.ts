import { getPublicConnectorSnapshot } from "@/lib/server/connectors";
import {
  resolveArtworkFromSnapshot,
  type ResolvedArtwork,
} from "@/lib/server/connectors/artwork";
import { isConnectorProvider } from "@/lib/server/connectors/types";

export const dynamic = "force-dynamic";

const MAX_ARTWORK_BYTES = 4_000_000;
const FETCH_TIMEOUT_MS = 6_000;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type RouteContext = {
  params: Promise<{ provider: string; itemId: string }>;
};

type EdgeCacheStorage = CacheStorage & { default?: Cache };

function edgeCache(): Cache | null {
  return typeof caches === "undefined"
    ? null
    : ((caches as EdgeCacheStorage).default ?? null);
}

function fallbackArtwork(aspect: "poster" | "square" = "poster"): Response {
  const height = aspect === "square" ? 240 : 320;
  const insetHeight = height - 48;
  const titleY = Math.round(height / 2 - 8);
  const labelY = titleY + 26;
  const body = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 ${height}" role="img" aria-label="Artwork unavailable">
      <rect width="240" height="${height}" fill="#e8edf1"/>
      <path d="M24 24h192v${insetHeight}H24z" fill="none" stroke="#17223b" stroke-width="2"/>
      <text x="120" y="${titleY}" text-anchor="middle" fill="#17223b" font-family="system-ui,sans-serif" font-size="18" font-weight="650">ANISH SHAH</text>
      <text x="120" y="${labelY}" text-anchor="middle" fill="#566173" font-family="monospace" font-size="11">ARTWORK UNAVAILABLE</text>
    </svg>`;
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

async function boundedImageBody(
  response: Response,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_ARTWORK_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARTWORK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function matchesMimeSignature(mime: string, body: Uint8Array): boolean {
  if (mime === "image/jpeg") {
    return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  }
  if (mime === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return body.length >= signature.length && signature.every((byte, index) => body[index] === byte);
  }
  return (
    body.length >= 12 &&
    new TextDecoder().decode(body.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(body.slice(8, 12)) === "WEBP"
  );
}

async function fetchArtwork(
  source: ResolvedArtwork,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(source.upstreamUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "image/webp,image/png,image/jpeg",
        "User-Agent": "Anish-Shah-personal-site/1.0",
      },
    });
  } catch {
    return fallbackArtwork(source.aspect);
  }
  if (!upstream.ok || upstream.status >= 300) return fallbackArtwork(source.aspect);

  const mime = upstream.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mime || !ALLOWED_MIME_TYPES.has(mime)) return fallbackArtwork(source.aspect);

  const body = await boundedImageBody(upstream);
  if (!body || !matchesMimeSignature(mime, body)) return fallbackArtwork(source.aspect);

  return new Response(body.buffer, {
    headers: {
      "cache-control": `public, max-age=${source.cacheMaxAgeSeconds ?? 86_400}, stale-while-revalidate=${source.cacheMaxAgeSeconds ? 21_600 : 604_800}`,
      "content-length": String(body.byteLength),
      "content-type": mime,
      "x-content-type-options": "nosniff",
    },
  });
}

async function artworkCacheKey(
  requestUrl: string,
  source: ResolvedArtwork,
): Promise<Request> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source.cacheIdentity),
  );
  const version = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const cacheUrl = new URL(requestUrl);
  cacheUrl.search = "";
  cacheUrl.searchParams.set("v", version);
  return new Request(cacheUrl, { method: "GET" });
}

export async function GET(request: Request, context: RouteContext) {
  const { provider: candidate, itemId } = await context.params;
  if (!isConnectorProvider(candidate)) return fallbackArtwork();
  const fallbackAspect =
    candidate === "spotify" || candidate === "steam" ? "square" : "poster";

  // Publication is checked before the edge cache so disconnecting a provider
  // immediately prevents an older cached cover from being served.
  const snapshot = await getPublicConnectorSnapshot(candidate);
  if (snapshot.status !== "ready") return fallbackArtwork(fallbackAspect);
  const source = resolveArtworkFromSnapshot(candidate, snapshot.payload, itemId);
  if (!source) return fallbackArtwork(fallbackAspect);

  const cache = edgeCache();
  const cacheKey = await artworkCacheKey(request.url, source);
  const cached = await cache?.match(cacheKey);
  // Cache API responses carry an immutable Headers guard. Vinext appends its
  // RSC Vary header after the route returns, so hand it an equivalent mutable
  // response instead of returning the cache object directly.
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: new Headers(cached.headers),
    });
  }

  const response = await fetchArtwork(source);
  if (response.headers.get("content-type") !== "image/svg+xml; charset=utf-8") {
    await cache?.put(cacheKey, response.clone());
  }
  return response;
}
