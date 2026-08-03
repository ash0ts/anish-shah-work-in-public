import { PUBLIC_CLOUDFLARE_ACCOUNT_ID } from "./lib/release-config-contract.mjs";
import {
  collectOpenPullRequestNumbers,
  ownedPreviewDomainRecord,
  previewPrFromWorkerName,
  previewResourceCoordinates,
} from "./lib/preview-resource-contract.mjs";

const action = process.argv[2] ?? "cleanup";
if (!new Set(["cleanup", "janitor"]).has(action)) {
  throw new Error("Use preview-cleanup.mjs cleanup or janitor.");
}
if (!process.argv.includes("--apply")) {
  throw new Error("Preview deletion requires the explicit --apply flag.");
}
const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!cloudflareToken) throw new Error("CLOUDFLARE_API_TOKEN is required.");

async function cloudflare(pathname, init = {}, allowNotFound = false) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${PUBLIC_CLOUDFLARE_ACCOUNT_ID}${pathname}`,
    {
      ...init,
      headers: { authorization: `Bearer ${cloudflareToken}` },
    },
  );
  const body = await response.json().catch(() => null);
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare preview cleanup failed with HTTP ${response.status}.`);
  }
  return body.result;
}

async function deletePreview(prNumber) {
  const coordinates = previewResourceCoordinates(prNumber);
  const query = new URLSearchParams({
    hostname: coordinates.hostname,
    service: coordinates.workerName,
    per_page: "100",
  });
  const domains = await cloudflare(`/workers/domains?${query}`);
  if (!Array.isArray(domains) || domains.length > 1) {
    throw new Error("Cloudflare returned an ambiguous exact preview domain query.");
  }
  const record = ownedPreviewDomainRecord(domains ?? [], coordinates);
  if (record) {
    await cloudflare(
      `/workers/domains/${encodeURIComponent(record.id)}`,
      { method: "DELETE" },
    );
    console.log(`Detached ephemeral preview Custom Domain ${coordinates.hostname}.`);
  }
  const deleted = await cloudflare(
    `/workers/scripts/${encodeURIComponent(coordinates.workerName)}`,
    { method: "DELETE" },
    true,
  );
  if (deleted !== null) {
    console.log(`Deleted ephemeral preview Worker ${coordinates.workerName}.`);
  }
}

if (action === "cleanup") {
  const prNumber = process.env.PREVIEW_PR_NUMBER?.trim();
  await deletePreview(prNumber);
} else {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!githubToken || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required for janitor mode.");
  }
  const open = await collectOpenPullRequestNumbers(
    async (page, pageSize) => {
      const endpoint = new URL(`https://api.github.com/repos/${repository}/pulls`);
      endpoint.searchParams.set("state", "open");
      endpoint.searchParams.set("per_page", String(pageSize));
      endpoint.searchParams.set("page", String(page));
      const response = await fetch(endpoint, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${githubToken}`,
          "user-agent": "anish-site-preview-janitor",
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub PR lookup failed with HTTP ${response.status}.`);
      }
      return response.json();
    },
  );
  const workers = await cloudflare("/workers/scripts");
  for (const worker of workers ?? []) {
    const prNumber = previewPrFromWorkerName(worker?.id ?? "");
    if (prNumber && !open.has(prNumber)) await deletePreview(prNumber);
  }
}
