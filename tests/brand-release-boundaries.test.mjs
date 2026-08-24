import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  releaseTextExtensions,
  releaseTextViolations,
} from "../scripts/scan-release-bundle.mjs";
import {
  attestedArtifactPaths,
  buildPublicContentAttestation,
  organizationAssetArtifactPaths,
} from "../scripts/public-content-attestation.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function writeFixture(root, relativePath, value) {
  const outputPath = path.join(root, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, value);
}

test("the release text scan includes deployed SVG and rejects active content", () => {
  assert.equal(releaseTextExtensions.has(".svg"), true);
  assert.deepEqual(
    releaseTextViolations(
      "dist/client/assets/organizations/safe.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
    ),
    [],
  );

  const unsafeCases = [
    ["<script>alert(1)</script>", "SVG script element"],
    ["<svg:script>alert(1)</svg:script>", "SVG script element"],
    ['<path onclick="alert(1)"/>', "SVG event handler"],
    ['<foreignObject><p>unsafe</p></foreignObject>', "SVG active or embedded content"],
    ['<image href="data:image/png;base64,AA=="/>', "SVG active or embedded content"],
    ['<use href="https://example.com/mark.svg#logo"/>', "SVG external or executable reference"],
    ['<path fill="url(https://example.com/paint)"/>', "SVG external or executable reference"],
    [`<!-- /${"Users"}/private/source.svg -->`, "macOS user path"],
    ['<!-- content/private/profile.md -->', "private content path"],
    [
      '<!DOCTYPE svg SYSTEM "https://example.com/unsafe.dtd">',
      "SVG external document declaration",
    ],
  ];

  for (const [body, expected] of unsafeCases) {
    assert.ok(
      releaseTextViolations(
        "dist/client/assets/organizations/unsafe.svg",
        `<svg>${body}</svg>`,
      ).includes(expected),
      `${expected} should be rejected`,
    );
  }
});

test("organization asset attestation paths are closed, unique, and sorted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anish-brand-attestation-"));
  try {
    await writeFixture(
      root,
      "content/presentation/brand-assets.v1.json",
      JSON.stringify({
        schemaVersion: "1.0",
        assets: [
          { assetPath: "/assets/organizations/zeta.123.svg" },
          { assetPath: "/assets/organizations/alpha.456.png" },
        ],
      }),
    );
    assert.deepEqual(await organizationAssetArtifactPaths(root), [
      "public/assets/organizations/alpha.456.png",
      "public/assets/organizations/zeta.123.svg",
    ]);

    await writeFixture(
      root,
      "content/presentation/brand-assets.v1.json",
      JSON.stringify({
        schemaVersion: "1.0",
        assets: [
          { assetPath: "/assets/organizations/reused.svg" },
          { assetPath: "/assets/organizations/reused.svg" },
        ],
      }),
    );
    await assert.rejects(
      organizationAssetArtifactPaths(root),
      /duplicate asset path/u,
    );

    await writeFixture(
      root,
      "content/presentation/brand-assets.v1.json",
      JSON.stringify({
        schemaVersion: "1.0",
        assets: [{ assetPath: "/assets/organizations/../private.svg" }],
      }),
    );
    await assert.rejects(
      organizationAssetArtifactPaths(root),
      /unsafe asset path/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the public content attestation hashes presentation manifests and deployed brand assets deterministically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anish-public-attestation-"));
  try {
    const publicBundle = {
      contentVersion: "fixture-version",
      generatedAt: "2026-08-05T00:00:00.000Z",
      items: [],
      entities: [],
      workGroups: [],
      metrics: [],
      metricGroups: [],
      evidence: [],
      relations: [],
      collections: [],
      narratives: [],
      sourceSnapshots: [],
      sourceSummary: {},
    };
    await writeFixture(
      root,
      "content/public/anish-content.public.v1.json",
      JSON.stringify(publicBundle),
    );
    await writeFixture(
      root,
      "content/presentation/brand-assets.v1.json",
      JSON.stringify({
        schemaVersion: "1.0",
        assets: [
          { assetPath: "/assets/organizations/zeta.123.svg" },
          { assetPath: "/assets/organizations/alpha.456.png" },
        ],
      }),
    );

    const expectedPaths = await attestedArtifactPaths(root);
    for (const relativePath of expectedPaths) {
      if (relativePath === "content/public/anish-content.public.v1.json") continue;
      if (relativePath === "content/presentation/brand-assets.v1.json") continue;
      const value = relativePath.endsWith(".png")
        ? Buffer.from([0x89, 0x50, 0x4e, 0x47])
        : relativePath.endsWith(".svg")
          ? '<svg xmlns="http://www.w3.org/2000/svg"/>'
          : "{}";
      await writeFixture(root, relativePath, value);
    }
    await writeFixture(root, "scripts/build-content.mjs", "export {};\n");
    await writeFixture(root, "scripts/lib/csv.mjs", "export {};\n");
    await writeFixture(root, "scripts/content/example.mjs", "export {};\n");

    const first = await buildPublicContentAttestation(root);
    const second = await buildPublicContentAttestation(root);
    assert.deepEqual(second, first);

    const paths = first.artifacts.map((artifact) => artifact.path);
    assert.ok(paths.includes("content/presentation/career.v1.json"));
    assert.ok(paths.includes("content/presentation/speaker-profile.v1.json"));
    assert.ok(paths.includes("content/presentation/work-organizations.v1.json"));
    assert.ok(paths.includes("content/presentation/brand-assets.v1.json"));
    assert.deepEqual(paths.slice(-2), [
      "public/assets/organizations/alpha.456.png",
      "public/assets/organizations/zeta.123.svg",
    ]);

    const svgArtifact = first.artifacts.at(-1);
    const svgBytes = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    assert.deepEqual(svgArtifact, {
      path: "public/assets/organizations/zeta.123.svg",
      bytes: Buffer.byteLength(svgBytes),
      sha256: sha256(svgBytes),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the repository attestation records every reviewed organization asset's deployed bytes", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(projectRoot, "content/presentation/brand-assets.v1.json"),
      "utf8",
    ),
  );
  const first = await buildPublicContentAttestation(projectRoot);
  const second = await buildPublicContentAttestation(projectRoot);
  assert.deepEqual(second, first);

  const artifactByPath = new Map(
    first.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  for (const manifestPath of [
    "content/presentation/career.v1.json",
    "content/presentation/speaker-profile.v1.json",
    "content/presentation/work-organizations.v1.json",
    "content/presentation/brand-assets.v1.json",
  ]) {
    assert.ok(artifactByPath.has(manifestPath), `${manifestPath} is attested`);
  }

  const expectedAssetPaths = manifest.assets
    .map((asset) => `public${asset.assetPath}`)
    .sort();
  assert.deepEqual(
    first.artifacts
      .map((artifact) => artifact.path)
      .filter((artifactPath) =>
        artifactPath.startsWith("public/assets/organizations/"),
      ),
    expectedAssetPaths,
  );

  for (const asset of manifest.assets) {
    const relativePath = `public${asset.assetPath}`;
    const bytes = await readFile(path.join(projectRoot, relativePath));
    const actualSha256 = sha256(bytes);
    assert.equal(actualSha256, asset.deployedSha256, `${asset.id} manifest hash`);
    assert.deepEqual(artifactByPath.get(relativePath), {
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: actualSha256,
    });
  }
});
