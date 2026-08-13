import { readFile } from "node:fs/promises";
import { imageSize } from "./index.mjs";

export async function imageSizeFromFile(path) {
  return imageSize(await readFile(path));
}

export function setConcurrency(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Concurrency must be a positive integer.");
  }
}
