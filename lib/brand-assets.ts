import registryJson from "@/content/presentation/brand-assets.v1.json" with {
  type: "json",
};

export const brandAssetUsageBases = [
  "official-brand-kit",
  "official-press-kit",
  "published-third-party-guidelines",
] as const;

export type BrandAssetUsageBasis = (typeof brandAssetUsageBases)[number];

export type BrandAsset = {
  id: string;
  assetPath: `/assets/organizations/${string}.${"svg" | "png"}`;
  mediaType: "image/svg+xml" | "image/png";
  width: number;
  height: number;
  sourcePageUrl: string;
  sourceAssetUrl: string;
  termsUrl: string;
  lastVerified: string;
  sourceSha256: string;
  deployedSha256: string;
  usageBasis: BrandAssetUsageBasis;
};

export type BrandAssetRegistry = {
  schemaVersion: "1.0";
  assets: BrandAsset[];
};

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const ASSET_PATH =
  /^\/assets\/organizations\/[a-z0-9][a-z0-9-]*(?:[.-][a-f0-9]{12,64})\.(svg|png)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const usageBasisSet = new Set<BrandAssetUsageBasis>(brandAssetUsageBases);

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isBoundedDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 8192
  );
}

function parseBrandAsset(value: unknown): BrandAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("brand_asset_invalid");
  }

  const asset = value as Record<string, unknown>;
  if (
    !exactKeys(asset, [
      "id",
      "assetPath",
      "mediaType",
      "width",
      "height",
      "sourcePageUrl",
      "sourceAssetUrl",
      "termsUrl",
      "lastVerified",
      "sourceSha256",
      "deployedSha256",
      "usageBasis",
    ]) ||
    typeof asset.id !== "string" ||
    !IDENTIFIER.test(asset.id) ||
    typeof asset.assetPath !== "string" ||
    !ASSET_PATH.test(asset.assetPath) ||
    (asset.mediaType !== "image/svg+xml" &&
      asset.mediaType !== "image/png") ||
    !isBoundedDimension(asset.width) ||
    !isBoundedDimension(asset.height) ||
    asset.width * asset.height > 16_777_216 ||
    typeof asset.sourcePageUrl !== "string" ||
    !isHttpsUrl(asset.sourcePageUrl) ||
    typeof asset.sourceAssetUrl !== "string" ||
    !isHttpsUrl(asset.sourceAssetUrl) ||
    typeof asset.termsUrl !== "string" ||
    !isHttpsUrl(asset.termsUrl) ||
    typeof asset.lastVerified !== "string" ||
    !isIsoCalendarDate(asset.lastVerified) ||
    typeof asset.sourceSha256 !== "string" ||
    !SHA256.test(asset.sourceSha256) ||
    typeof asset.deployedSha256 !== "string" ||
    !SHA256.test(asset.deployedSha256) ||
    typeof asset.usageBasis !== "string" ||
    !usageBasisSet.has(asset.usageBasis as BrandAssetUsageBasis)
  ) {
    throw new Error("brand_asset_invalid");
  }

  const extension = asset.assetPath.endsWith(".svg") ? "svg" : "png";
  const expectedMediaType =
    extension === "svg" ? "image/svg+xml" : "image/png";
  if (
    asset.mediaType !== expectedMediaType ||
    !asset.assetPath.includes(asset.deployedSha256.slice(0, 12))
  ) {
    throw new Error("brand_asset_contract_mismatch");
  }

  return asset as BrandAsset;
}

export function parseBrandAssetRegistry(value: unknown): BrandAssetRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("brand_asset_registry_invalid");
  }

  const registry = value as Record<string, unknown>;
  if (
    !exactKeys(registry, ["schemaVersion", "assets"]) ||
    registry.schemaVersion !== "1.0" ||
    !Array.isArray(registry.assets) ||
    registry.assets.length === 0 ||
    registry.assets.length > 64
  ) {
    throw new Error("brand_asset_registry_invalid");
  }

  const assets = registry.assets.map(parseBrandAsset);
  if (
    new Set(assets.map(({ id }) => id)).size !== assets.length ||
    new Set(assets.map(({ assetPath }) => assetPath)).size !== assets.length ||
    new Set(assets.map(({ deployedSha256 }) => deployedSha256)).size !==
      assets.length
  ) {
    throw new Error("brand_asset_registry_duplicate");
  }

  return { schemaVersion: "1.0", assets };
}

export function brandAssetMapFrom(
  value: unknown = registryJson,
): ReadonlyMap<string, BrandAsset> {
  const registry = parseBrandAssetRegistry(value);
  return new Map(registry.assets.map((asset) => [asset.id, asset]));
}

const checkedInBrandAssets = brandAssetMapFrom(registryJson);

export function brandAssetForId(
  id: string,
  value?: unknown,
): BrandAsset | null {
  const assets =
    value === undefined ? checkedInBrandAssets : brandAssetMapFrom(value);
  return assets.get(id) ?? null;
}
