import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cloudflareStubUrl = new URL(
  "./content-cloudflare-workers-stub.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: cloudflareStubUrl, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isExtensionlessRelative =
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      context.parentURL &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z0-9]+$/i.test(specifier);
    if (!isExtensionlessRelative) throw error;

    for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      if (candidate.protocol === "file:" && existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    throw error;
  }
}
