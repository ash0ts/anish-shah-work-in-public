import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cloudflareStubUrl = new URL(
  "./content-cloudflare-workers-stub.mjs",
  import.meta.url,
).href;

function fileCandidate(base) {
  const candidates = [base];
  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    candidates.push(new URL(`${base.href}${extension}`));
    candidates.push(new URL(`${base.href.replace(/\/$/, "")}/index${extension}`));
  }
  return candidates.find(
    (candidate) =>
      candidate.protocol === "file:" &&
      existsSync(fileURLToPath(candidate)) &&
      statSync(fileURLToPath(candidate)).isFile(),
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: cloudflareStubUrl, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const candidate = fileCandidate(
      new URL(`../${specifier.slice(2)}`, import.meta.url),
    );
    if (candidate) return { url: candidate.href, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isExtensionlessRelative =
      (error?.code === "ERR_MODULE_NOT_FOUND" ||
        error?.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
      context.parentURL &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z0-9]+$/i.test(specifier);
    if (!isExtensionlessRelative) throw error;

    const candidate = fileCandidate(new URL(specifier, context.parentURL));
    if (candidate) return { url: candidate.href, shortCircuit: true };
    throw error;
  }
}
