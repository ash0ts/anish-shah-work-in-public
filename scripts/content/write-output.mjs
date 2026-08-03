/** Atomic generated-output writes and deterministic check mode. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

async function writeAtomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

export async function writeOrCheck(outputs, check, projectRoot) {
  for (const [file, content] of outputs) {
    if (check) {
      let current;
      try {
        current = await readFile(file, "utf8");
      } catch {
        throw new Error(`Generated output is missing: ${path.relative(projectRoot, file)}`);
      }
      if (current !== content) {
        throw new Error(`Generated output is stale: ${path.relative(projectRoot, file)}`);
      }
    } else {
      await writeAtomic(file, content);
    }
  }
}
