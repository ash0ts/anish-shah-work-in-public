import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseSha = process.env.PREVIEW_SOURCE_SHA?.trim().toLowerCase();
const workflowSha = process.env.PREVIEW_WORKFLOW_SHA?.trim().toLowerCase();
const prNumber = process.env.PREVIEW_PR_NUMBER?.trim();
if (!releaseSha || !/^[a-f0-9]{40}$/.test(releaseSha)) {
  throw new Error("PREVIEW_SOURCE_SHA must be an exact commit SHA.");
}
if (!workflowSha || !/^[a-f0-9]{40}$/.test(workflowSha)) {
  throw new Error("PREVIEW_WORKFLOW_SHA must be an exact commit SHA.");
}
if (!prNumber || !/^[1-9][0-9]{0,6}$/.test(prNumber)) {
  throw new Error("PREVIEW_PR_NUMBER must be a positive PR number.");
}
const bundle = JSON.parse(
  await readFile(
    path.join(root, "content/public/anish-content.public.v1.json"),
    "utf8",
  ),
);
if (!/^[a-f0-9]{16}$/.test(bundle.contentVersion)) {
  throw new Error("The public content version is invalid.");
}
await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(
  path.join(root, "dist/preview-metadata.json"),
  `${JSON.stringify({
    schemaVersion: "1.1",
    releaseSha,
    sourceSha: releaseSha,
    workflowSha,
    prNumber,
    contentVersion: bundle.contentVersion,
    syntheticConnectorData: true,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
