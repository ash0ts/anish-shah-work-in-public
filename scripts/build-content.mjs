#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildContent } from "./content/pipeline.mjs";

export { buildContent } from "./content/pipeline.mjs";

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const summary = await buildContent({ check: process.argv.includes("--check") });
    process.stdout.write(
      `${summary.checked ? "Checked" : "Generated"} content ${summary.contentVersion}: ` +
        `${summary.footprintRows} footprint rows, ${summary.impactRows} impact rows, ` +
        `${summary.publicItems} public items, ${summary.publicMetrics} public metrics, ` +
        `${summary.relations} relations.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
