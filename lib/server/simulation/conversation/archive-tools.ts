import type { ConversationSource } from "@/lib/simulation/conversation-contract";
import type { ArchiveTools } from "./provider";
import { readSimulationCatalog } from "./catalog";
import {
  conversationInputAllowed,
  conversationSourceAllowed,
} from "./screening";
import type { Discovery } from "@/lib/simulation/network/catalog-contract";

/** The model receives only bounded projections, never repository/provider handles. */
export function createArchiveTools(
  initial: ConversationSource[],
  resolve: (ids: string[]) => Promise<ConversationSource[]>,
  claim: () => Promise<boolean>,
): ArchiveTools {
  const known = new Map(initial.map((source) => [source.id, source]));
  function accept(items: ConversationSource[]) {
    const accepted: ConversationSource[] = [];
    for (const item of items) {
      if (
        !conversationSourceAllowed(
          [item.title, item.text, item.limit ?? ""].join(" "),
        )
      )
        continue;
      if (!known.has(item.id) && known.size >= 8) continue;
      if (new TextEncoder().encode(JSON.stringify(item)).byteLength > 5000)
        continue;
      known.set(item.id, item);
      accepted.push(item);
      if (accepted.length === 4) break;
    }
    return accepted;
  }
  return {
    claim,
    operations: [],
    sources: () => [...known.values()],
    async revalidate() {
      const fresh = new Map(
        (await resolve([...known.keys()])).map((source) => [source.id, source]),
      );
      return [...known].every(
        ([id, source]) =>
          JSON.stringify(fresh.get(id)) === JSON.stringify(source),
      );
    },
    async search(domain, query) {
      if (!conversationInputAllowed(query)) return [];
      const page = await readSimulationCatalog(
        domain,
        query,
        1,
        "google_gemini_processing",
      );
      // Resolve again through the canonical grounding projector: game catalog
      // fields (versions/provenance) must not drift from turn validation.
      const ids = page.items.slice(0, 4).map((item) => item.id);
      return accept(
        (await resolve(ids)).filter((item) => ids.includes(item.id)),
      );
    },
    async read(id) {
      return known.has(id)
        ? accept((await resolve([id])).filter((item) => item.id === id))
        : [];
    },
    async compare(ids) {
      if (new Set(ids).size !== 2 || ids.some((id) => !known.has(id)))
        return { sources: [], sharedMetadata: [] };
      const items: Discovery[] = [];
      for (const id of ids) {
        const domain = id.startsWith("saved:")
          ? /^saved:(myanimelist|hardcover|spotify|discogs|steam):/.exec(
              id,
            )?.[1]
          : "work";
        if (!domain) return { sources: [], sharedMetadata: [] };
        const page = await readSimulationCatalog(
          domain as Parameters<typeof readSimulationCatalog>[0],
          "",
          1,
          "google_gemini_processing",
          [id],
        );
        if (!page.items[0]) return { sources: [], sharedMetadata: [] };
        items.push(page.items[0]);
      }
      return {
        sources: accept(
          (await resolve(ids)).filter((item) => ids.includes(item.id)),
        ),
        sharedMetadata: items[0].topics
          .filter((t) => items[1].topics.some((other) => other.id === t.id))
          .slice(0, 8)
          .map((t) => t.label),
      };
    },
  };
}
