import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { tsImport } from "tsx/esm/api";

const {
  brandAssetForId,
  brandAssetMapFrom,
  parseBrandAssetRegistry,
} = await tsImport("../lib/brand-assets.ts", import.meta.url);
const { validateBrandAssets } = await import(
  "../scripts/validate-brand-assets.mjs"
);

const SAFE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><path fill="#14213d" d="M0 0h120v40H0z"/></svg>\n',
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function registryAsset(bytes, overrides = {}) {
  const deployedSha256 = sha256(bytes);
  return {
    id: "fixture-brand",
    assetPath: `/assets/organizations/fixture-brand.${deployedSha256.slice(0, 12)}.svg`,
    mediaType: "image/svg+xml",
    width: 120,
    height: 40,
    sourcePageUrl: "https://brand.example/guide",
    sourceAssetUrl: "https://brand.example/official.svg",
    termsUrl: "https://brand.example/terms",
    lastVerified: "2026-08-05",
    sourceSha256: deployedSha256,
    deployedSha256,
    usageBasis: "official-brand-kit",
    ...overrides,
  };
}

async function fixtureProject(bytes = SAFE_SVG, overrides = {}) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "brand-assets-"));
  const asset = registryAsset(bytes, overrides);
  await mkdir(path.join(projectRoot, "content/presentation"), { recursive: true });
  await mkdir(path.join(projectRoot, "public/assets/organizations"), {
    recursive: true,
  });
  await mkdir(
    path.join(projectRoot, "tests/fixtures/brand-assets/official-sources"),
    { recursive: true },
  );
  await writeFile(
    path.join(projectRoot, "content/presentation/brand-assets.v1.json"),
    `${JSON.stringify({ schemaVersion: "1.0", assets: [asset] }, null, 2)}\n`,
  );
  await writeFile(
    path.join(projectRoot, "content/presentation/career.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        phases: [
          {
            id: "official-phase",
            mark: { kind: "official", brandAssetId: asset.id },
          },
          {
            id: "fallback-phase",
            mark: { kind: "typographic", brandAssetId: null },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(
      projectRoot,
      "content/presentation/work-organizations.v1.json",
    ),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        marks: [{ id: "fallback-mark", brandAssetId: null }],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(projectRoot, "public", asset.assetPath.slice(1)), bytes);
  await writeFile(
    path.join(
      projectRoot,
      "tests/fixtures/brand-assets/official-sources",
      `${asset.id}.source.${asset.mediaType === "image/svg+xml" ? "svg" : "png"}`,
    ),
    bytes,
  );
  return { asset, projectRoot };
}

test("the checked-in official brand registry and deployed files pass the offline gate", async () => {
  const { errors, registry } = await validateBrandAssets();
  assert.deepEqual(errors, []);
  assert(registry.assets.length > 0);
  assert.equal(brandAssetMapFrom(registry).size, registry.assets.length);
  assert.equal(
    brandAssetForId(registry.assets[0].id, registry)?.assetPath,
    registry.assets[0].assetPath,
  );
  assert.equal(brandAssetForId("not-approved", registry), null);
});

test("registry parsing rejects unknown fields, insecure provenance, and extension drift", () => {
  const asset = registryAsset(SAFE_SVG);
  assert.throws(
    () =>
      parseBrandAssetRegistry({
        schemaVersion: "1.0",
        assets: [{ ...asset, unexpected: true }],
      }),
    /brand_asset_invalid/u,
  );
  assert.throws(
    () =>
      parseBrandAssetRegistry({
        schemaVersion: "1.0",
        assets: [{ ...asset, termsUrl: "http://brand.example/terms" }],
      }),
    /brand_asset_invalid/u,
  );
  assert.throws(
    () =>
      parseBrandAssetRegistry({
        schemaVersion: "1.0",
        assets: [{ ...asset, mediaType: "image/png" }],
      }),
    /brand_asset_contract_mismatch/u,
  );
});

test("consumer manifests require resolvable asset IDs and consistent career mark kinds", async () => {
  const { projectRoot } = await fixtureProject();
  const careerPath = path.join(
    projectRoot,
    "content/presentation/career.v1.json",
  );
  const organizationsPath = path.join(
    projectRoot,
    "content/presentation/work-organizations.v1.json",
  );
  try {
    await writeFile(
      careerPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        phases: [
          {
            id: "bad-official",
            mark: { kind: "official", brandAssetId: null },
          },
          {
            id: "bad-fallback",
            mark: { kind: "typographic", brandAssetId: "fixture-brand" },
          },
        ],
      })}\n`,
    );
    await writeFile(
      organizationsPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        marks: [{ id: "unknown-mark", brandAssetId: "missing-brand" }],
      })}\n`,
    );
    const { errors } = await validateBrandAssets({ projectRoot });
    assert(errors.some((error) => /official career mark must reference/u.test(error)));
    assert(errors.some((error) => /typographic career mark must use brandAssetId null/u.test(error)));
    assert(errors.some((error) => /unknown brandAssetId missing-brand/u.test(error)));
    assert(errors.some((error) => /registry asset is not referenced/u.test(error)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("missing career or organization presentation manifests fail closed", async () => {
  for (const name of ["career.v1.json", "work-organizations.v1.json"]) {
    const { projectRoot } = await fixtureProject();
    try {
      await unlink(path.join(projectRoot, "content/presentation", name));
      const { errors } = await validateBrandAssets({ projectRoot });
      assert(
        errors.some((error) => error.startsWith(`${name}: missing`)),
        `${name} unexpectedly passed`,
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
});

test("SVG validation rejects active content, styles, animation, entities, and nonlocal references", async (t) => {
  const attacks = [
    ["script", '<script>alert(1)</script>'],
    ["style", '<style>path{fill:red}</style>'],
    ["handler", '<path onclick="alert(1)"/>'],
    ["animation", '<animate attributeName="x"/>'],
    ["foreign object", '<foreignObject><div>unsafe</div></foreignObject>'],
    ["embedded image", '<image href="data:image/png;base64,AA=="/>'],
    ["external reference", '<use href="https://example.com/a.svg#mark"/>'],
    ["entity", '<text>&amp;</text>'],
    ["processing instruction", '<?xml version="1.0"?>'],
    [
      "namespaced style",
      '<x:style xmlns:x="http://www.w3.org/2000/svg">path{fill:red}</x:style>',
    ],
    [
      "namespaced animation",
      '<x:animate xmlns:x="http://www.w3.org/2000/svg" attributeName="x"/>',
    ],
    [
      "namespaced image",
      '<x:image xmlns:x="http://www.w3.org/2000/svg" x:href="https://example.com/a.png"/>',
    ],
  ];

  for (const [name, injection] of attacks) {
    await t.test(name, async () => {
      const source = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">${injection}<path d="M0 0h120v40H0z"/></svg>`,
      );
      const { projectRoot } = await fixtureProject(source);
      try {
        const { errors } = await validateBrandAssets({ projectRoot });
        assert(errors.length > 0, `${name} unexpectedly passed`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test("the file gate rejects digest drift, intrinsic-dimension drift, and orphan assets", async () => {
  const { asset, projectRoot } = await fixtureProject();
  try {
    await writeFile(
      path.join(projectRoot, "public", asset.assetPath.slice(1)),
      Buffer.concat([SAFE_SVG, Buffer.from("<!-- changed -->")]),
    );
    await writeFile(
      path.join(projectRoot, "public/assets/organizations/orphan.000000000000.svg"),
      SAFE_SVG,
    );
    const { errors } = await validateBrandAssets({ projectRoot });
    assert(errors.some((error) => /deployedSha256/u.test(error)));
    assert(errors.some((error) => /orphaned asset/u.test(error)));

    const mismatch = await fixtureProject(SAFE_SVG, { width: 121 });
    try {
      const result = await validateBrandAssets({ projectRoot: mismatch.projectRoot });
      assert(result.errors.some((error) => /intrinsic dimensions/u.test(error)));
    } finally {
      await rm(mismatch.projectRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("the provenance gate verifies exact official source bytes", async () => {
  const { asset, projectRoot } = await fixtureProject();
  try {
    await writeFile(
      path.join(
        projectRoot,
        "tests/fixtures/brand-assets/official-sources",
        `${asset.id}.source.svg`,
      ),
      Buffer.concat([SAFE_SVG, Buffer.from("<!-- source drift -->")]),
    );
    const { errors } = await validateBrandAssets({ projectRoot });
    assert(errors.some((error) => /sourceSha256/u.test(error)));
    assert(errors.some((error) => /deterministic metadata-free form/u.test(error)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function onePixelPng(extraChunks = []) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    ...extraChunks,
    pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    pngChunk("IEND"),
  ]);
}

function boundedBombPng() {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4096, 0);
  ihdr.writeUInt32BE(4096, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.alloc(1024))),
    pngChunk("IEND"),
  ]);
}

test("PNG validation accepts bounded image data and rejects metadata and animation", async () => {
  const valid = onePixelPng();
  const validFixture = await fixtureProject(valid, {
    assetPath: `/assets/organizations/fixture-brand.${sha256(valid).slice(0, 12)}.png`,
    mediaType: "image/png",
    width: 1,
    height: 1,
  });
  try {
    assert.deepEqual(
      (await validateBrandAssets({ projectRoot: validFixture.projectRoot })).errors,
      [],
    );
  } finally {
    await rm(validFixture.projectRoot, { recursive: true, force: true });
  }

  for (const chunk of [
    pngChunk("pHYs", Buffer.alloc(9)),
    pngChunk("acTL", Buffer.alloc(8)),
  ]) {
    const unsafe = onePixelPng([chunk]);
    const fixture = await fixtureProject(unsafe, {
      assetPath: `/assets/organizations/fixture-brand.${sha256(unsafe).slice(0, 12)}.png`,
      mediaType: "image/png",
      width: 1,
      height: 1,
    });
    try {
      const { errors } = await validateBrandAssets({ projectRoot: fixture.projectRoot });
      assert(errors.some((error) => /metadata or animation/u.test(error)));
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  }
});

test("PNG validation rejects an excessive decode budget before inflation", async () => {
  const bomb = boundedBombPng();
  const fixture = await fixtureProject(bomb, {
    assetPath: `/assets/organizations/fixture-brand.${sha256(bomb).slice(0, 12)}.png`,
    mediaType: "image/png",
    width: 4096,
    height: 4096,
  });
  try {
    const { errors } = await validateBrandAssets({
      projectRoot: fixture.projectRoot,
    });
    assert(errors.some((error) => /decompression budget/u.test(error)));
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});
