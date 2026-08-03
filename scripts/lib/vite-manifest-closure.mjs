function requireManifestEntry(manifest, entryKey) {
  const entry = manifest[entryKey];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`Vite manifest entry is missing: ${entryKey}`);
  }
  return entry;
}

function addManifestFiles(files, entry, entryKey) {
  const candidates = [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.startsWith("/") ||
      candidate.split("/").includes("..")
    ) {
      throw new TypeError(
        `Vite manifest entry ${entryKey} contains an invalid output path.`,
      );
    }
    files.add(candidate);
  }
}

export function findViteManifestEntryBySource(manifest, source) {
  const matches = Object.entries(manifest).filter(
    ([entryKey, entry]) => entryKey === source || entry?.src === source,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Expected one Vite manifest entry for ${source}; found ${matches.length}.`,
    );
  }
  return matches[0][0];
}

/**
 * Return every file fetched by a Vite entry's static import graph.
 *
 * Vite's `imports` edges are followed transitively. `dynamicImports` are
 * intentionally not followed because they are separate, conditional fetches;
 * callers must give each activated dynamic entry its own explicit budget.
 */
export function collectViteStaticDependencyClosure(manifest, rootEntryKey) {
  const entryKeys = new Set();
  const files = new Set();

  function visit(entryKey) {
    if (entryKeys.has(entryKey)) return;
    const entry = requireManifestEntry(manifest, entryKey);
    entryKeys.add(entryKey);
    addManifestFiles(files, entry, entryKey);

    const imports = entry.imports ?? [];
    if (!Array.isArray(imports)) {
      throw new TypeError(
        `Vite manifest entry ${entryKey} has a non-array imports field.`,
      );
    }
    for (const importedEntryKey of imports) {
      if (typeof importedEntryKey !== "string") {
        throw new TypeError(
          `Vite manifest entry ${entryKey} contains a non-string import.`,
        );
      }
      visit(importedEntryKey);
    }
  }

  visit(rootEntryKey);
  return { entryKeys, files };
}

export function subtractManifestFiles(closure, baseline) {
  return new Set([...closure].filter((file) => !baseline.has(file)));
}
