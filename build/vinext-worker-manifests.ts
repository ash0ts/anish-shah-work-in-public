import path from "node:path";
import type { Plugin } from "vite";

const MANIFEST_IMPORT = /(["'])\.\/((?:__vinext_(?:cacheability_manifest|cacheability_request_projection|pregenerated_concrete_paths)|vinext-client-assets)\.js)\1/g;

/**
 * Vinext 1.2 emits these runtime modules at the server output root, but marks
 * their imports external with root-relative-looking `./` specifiers. A custom
 * Cloudflare entry can put the importing chunk under `_next/static/` instead.
 * Resolve only these four known imports before hashing; never patch dist or
 * package sources. Remove once upstream handles nested custom Worker chunks.
 */
export function vinextWorkerManifests(): Plugin {
  return {
    name: "site:vinext-worker-manifests",
    apply: "build",
    renderChunk(code, chunk) {
      if (this.environment.name !== "rsc") return null;
      const directory = path.posix.dirname(chunk.fileName);
      const rewritten = code.replace(MANIFEST_IMPORT, (_match, quote, filename) => {
        const relative = path.posix.relative(directory, filename);
        return `${quote}${relative.startsWith(".") ? relative : `./${relative}`}${quote}`;
      });
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}
