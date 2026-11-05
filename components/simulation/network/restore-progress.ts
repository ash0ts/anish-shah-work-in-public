import {
  CATALOG_DOMAINS,
  type Discovery,
} from "@/lib/simulation/network/catalog-contract";
import {
  progressSchema,
  readProgress,
} from "@/lib/simulation/network/progress";
import { fixtureCatalog } from "@/lib/simulation/network/fixtures";

/** Revalidate only bounded saved IDs, never import or persist a whole library. */
export async function restoreDeviceProgress(
  raw: string | null,
  initial: Discovery[],
  previewWork: Discovery[],
  synthetic: boolean,
  signal: AbortSignal,
) {
  if (!raw || raw.length > 12_000) return null;
  const parsed = progressSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  const ids = [
    ...new Set([
      ...parsed.data.discoveries,
      ...parsed.data.equipped.flatMap((s) =>
        s.discoveryId ? [s.discoveryId] : [],
      ),
    ]),
  ];
  const visible = new Map(initial.map((item) => [item.id, item]));
  for (const domain of CATALOG_DOMAINS) {
    const wanted = ids.filter((id) =>
      domain === "work"
        ? id.startsWith("group:")
        : id.startsWith(`${synthetic ? "fixture" : "saved"}:${domain}:`),
    );
    for (let offset = 0; offset < wanted.length; offset += 24) {
      const batch = wanted.slice(offset, offset + 24);
      let items: Discovery[] = [];
      if (synthetic)
        items = (
          domain === "work"
            ? previewWork
            : [
                ...fixtureCatalog(domain, "", 1).items,
                ...fixtureCatalog(domain, "", 2).items,
              ]
        ).filter((item) => batch.includes(item.id));
      else {
        const response = await fetch(
          `/api/simulation/catalog?${new URLSearchParams({ domain, ids: batch.join(",") })}`,
          { cache: "no-store", signal },
        );
        if (!response.ok) throw new Error("progress_catalog_unavailable");
        items = (await response.json()).items;
      }
      for (const id of batch) visible.delete(id);
      for (const item of items)
        if (batch.includes(item.id)) visible.set(item.id, item);
    }
  }
  return {
    saved: readProgress(raw, new Set(visible.keys())),
    items: [...visible.values()],
  };
}
