import { getPublicConnectorSnapshot } from "../../connectors/repository";
import type { ConversationSource } from "@/lib/simulation/conversation-contract";
import { verifiedGooglePermissions } from "./permissions";
import { conversationSourceAllowed } from "./screening";

const routes = {
  myanimelist: "watch",
  hardcover: "read",
  spotify: "listen",
  discogs: "collect",
  steam: "play",
} as const;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function title(value: unknown) {
  return typeof value === "string" &&
    value.length <= 120 &&
    conversationSourceAllowed(value)
    ? value
    : null;
}

/** Only saved public snapshots with a separately encrypted Google permission. */
export async function approvedCollectionSources(): Promise<
  ConversationSource[]
> {
  const providers = await verifiedGooglePermissions();
  const sources: ConversationSource[] = [];
  for (const provider of providers) {
    const snapshot = await getPublicConnectorSnapshot(provider);
    if (snapshot.status !== "ready") continue;
    const payload = snapshot.payload as unknown as Record<string, unknown>;
    let rows: unknown[] = Array.isArray(payload.library) ? payload.library : [];
    if (provider === "spotify") {
      const window = record(record(payload.windows)?.short_term);
      rows = Array.isArray(window?.tracks) ? window.tracks : [];
    }
    const titles = [
      ...new Set(
        rows.flatMap((row) => {
          const t = title(record(row)?.title);
          return t ? [t] : [];
        }),
      ),
    ].slice(0, 12);
    if (!titles.length) continue;
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify({ titles, updatedAt: payload.syncedAt ?? null }),
        ),
      ),
    );
    const version = Array.from(digest.slice(0, 12), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    sources.push({
      id: `collection:${provider}:${version}`,
      title: `${provider} saved collection`,
      text: titles.join(" · "),
      limit:
        provider === "spotify"
          ? "A bounded sample of Spotify-calculated affinity, not play counts."
          : "A bounded sample of the saved collection, not a complete inventory.",
      period: typeof payload.syncedAt === "string" ? payload.syncedAt : null,
      href: `/play/${routes[provider]}`,
      citations: [],
    });
  }
  return sources;
}
