import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import sharp from "sharp";
import bundle from "../content/public/anish-content.public.v1.json" with { type: "json" };
import manifest from "../content/presentation/simulation.v1.json" with { type: "json" };
const { personalInternetFrom } = await tsImport(
  "../lib/server/simulation/conversation/workspace.ts",
  import.meta.url,
);
const { applyCopyDeckToBundle } = await tsImport(
  "../lib/copy.ts",
  import.meta.url,
);
const { catalog, featuredIds } = personalInternetFrom(
  applyCopyDeckToBundle(bundle),
);
test("original network atlases are transparent, metadata-free, local and under one MiB", async () => {
  assert.deepEqual(manifest.artwork.paths, [
    "/assets/simulation/network-cast-v1.webp",
    "/assets/simulation/network-props-v1.webp",
  ]);
  let total = 0;
  for (const path of manifest.artwork.paths) {
    const bytes = await readFile(new URL("../public" + path, import.meta.url));
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.hasAlpha, true);
    assert.equal(meta.width, meta.height);
    assert(meta.width <= 1024);
    assert.equal(meta.pages ?? 1, 1);
    for (const key of ["exif", "icc", "iptc", "xmp"])
      assert.equal(meta[key], undefined);
    total += bytes.length;
  }
  assert(total < 1024 * 1024);
});
test("reviewed discoveries span four work types without inventing evidence", () => {
  assert.equal(manifest.workspace.stage, "owner-network-preview");
  assert.equal(featuredIds.length, 6);
  assert.deepEqual(
    new Set(featuredIds.map((id) => catalog.find((c) => c.id === id).kind)),
    new Set(["terminal", "notebook", "document", "poster"]),
  );
  assert.equal(catalog.length, 88);
  assert(
    catalog.every(
      (c) => c.href.startsWith("/work/") && c.id.startsWith("group:"),
    ),
  );
  assert(
    catalog
      .flatMap((c) => c.citations)
      .every((c) =>
        bundle.evidence.some((e) => e.id === c.id && e.access === "public_web"),
      ),
  );
});
test("hidden work is absent from discovery catalog and featured foundations", () => {
  const hidden = structuredClone(bundle);
  hidden.workGroups.find((g) => g.id === featuredIds[0]).publicationState =
    "private";
  assert(
    !personalInternetFrom(hidden).catalog.some((c) => c.id === featuredIds[0]),
  );
  for (const group of hidden.workGroups) group.publicationState = "private";
  assert.deepEqual(personalInternetFrom(hidden), {
    catalog: [],
    featuredIds: [],
  });
});
test("synthetic collection pages are explicitly invented, bounded and contain no owner payload", async () => {
  const { fixtureCatalog } = await tsImport(
    "../lib/simulation/network/fixtures.ts",
    import.meta.url,
  );
  for (const provider of [
    "myanimelist",
    "hardcover",
    "steam",
    "spotify",
    "discogs",
  ]) {
    const page = fixtureCatalog(provider, "", 1);
    assert.equal(page.items.length, 24);
    assert.equal(page.nextPage, 2);
    assert(
      page.items.every(
        (i) => i.title.startsWith("Fixture") && /fixture/i.test(i.provenance),
      ),
    );
    assert.equal(fixtureCatalog(provider, "", 2).items.length, 2);
    assert.equal(
      fixtureCatalog(provider, "no matching invented title", 1).items.length,
      0,
    );
  }
});
