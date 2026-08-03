const PREVIEW_WORKER_PATTERN =
  /^anish-shah-work-in-public-pr-([1-9][0-9]{0,6})$/;
const PREVIEW_HOST_PATTERN =
  /^pr-([1-9][0-9]{0,6})\.anish-shah-is\.online$/;

export function previewResourceCoordinates(prNumber) {
  const normalized = String(prNumber ?? "").trim();
  if (!/^[1-9][0-9]{0,6}$/.test(normalized)) {
    throw new Error("The preview PR number is invalid.");
  }
  return {
    prNumber: normalized,
    workerName: `anish-shah-work-in-public-pr-${normalized}`,
    hostname: `pr-${normalized}.anish-shah-is.online`,
  };
}

export function previewPrFromWorkerName(workerName) {
  return PREVIEW_WORKER_PATTERN.exec(workerName ?? "")?.[1] ?? null;
}

export function previewPrFromHostname(hostname) {
  return PREVIEW_HOST_PATTERN.exec(hostname ?? "")?.[1] ?? null;
}

export function ownedPreviewDomainRecord(records, coordinates) {
  if (!Array.isArray(records)) {
    throw new Error("Cloudflare returned malformed Custom Domain records.");
  }
  const exact = records.filter(
    (record) => record?.hostname === coordinates.hostname,
  );
  if (!exact.length) return null;
  if (
    exact.length !== 1 ||
    exact[0]?.service !== coordinates.workerName ||
    previewPrFromHostname(exact[0]?.hostname) !== coordinates.prNumber ||
    previewPrFromWorkerName(exact[0]?.service) !== coordinates.prNumber ||
    typeof exact[0]?.id !== "string" ||
    !/^[A-Za-z0-9_-]{8,160}$/.test(exact[0].id)
  ) {
    throw new Error(
      "Refusing to detach a Custom Domain not owned by the exact preview Worker.",
    );
  }
  return exact[0];
}

export async function collectOpenPullRequestNumbers(
  fetchPage,
  { pageSize = 100, maxPages = 1_000 } = {},
) {
  if (
    typeof fetchPage !== "function" ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 1_000
  ) {
    throw new Error("The preview janitor pagination contract is invalid.");
  }

  const open = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const pulls = await fetchPage(page, pageSize);
    if (!Array.isArray(pulls) || pulls.length > pageSize) {
      throw new Error("GitHub returned malformed open pull request data.");
    }
    for (const pull of pulls) {
      const number = String(pull?.number ?? "");
      if (!/^[1-9][0-9]{0,6}$/.test(number)) {
        throw new Error("GitHub returned an invalid open pull request number.");
      }
      open.add(number);
    }
    if (pulls.length < pageSize) return open;
  }
  throw new Error("The preview janitor exceeded its bounded GitHub pagination limit.");
}
