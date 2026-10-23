import type { Plugin } from "vite";

const entryId = "\0virtual:vinext-rsc-entry";
const incorrectAccess =
  "__collectAppPageSearchParams(searchParams).searchParamsObject";
const correctAccess =
  "__collectAppPageSearchParams(searchParams).pageSearchParams";

// Vinext 0.0.50's page preflight reads the old property name, while its
// collector, metadata resolver, and actual render use pageSearchParams.
// Patch only that generated virtual entry; never mutate node_modules or dist.
// A dependency upgrade must review/remove this shim, not silently keep it.
export function vinextPageQueryCompat(): Plugin {
  return {
    name: "anish-vinext-page-query-compat",
    enforce: "pre",
    transform(source, id) {
      if (id !== entryId) return null;
      if (source.split(incorrectAccess).length !== 2) {
        throw new Error(
          "Vinext page-query preflight changed; review the pinned compatibility shim.",
        );
      }
      return { code: source.replace(incorrectAccess, correctAccess), map: null };
    },
  };
}
