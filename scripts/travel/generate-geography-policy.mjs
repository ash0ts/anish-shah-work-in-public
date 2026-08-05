import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const geographyRoot = path.join(root, "public/assets/travel/geography");
const outputPath = path.join(
  root,
  "lib/server/travel/geography-policy.generated.json",
);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  );
}

function point(centroid) {
  if (
    !Array.isArray(centroid) ||
    centroid.length !== 2 ||
    !centroid.every(Number.isFinite)
  ) {
    throw new Error("Natural Earth centroid is invalid.");
  }
  return {
    lat: Math.round(centroid[1] * 10) / 10,
    lng: Math.round(centroid[0] * 10) / 10,
  };
}

async function build() {
  const manifest = JSON.parse(
    await readFile(path.join(geographyRoot, "manifest.v1.json"), "utf8"),
  );
  const countrySource = JSON.parse(
    await readFile(path.join(geographyRoot, manifest.countries.path), "utf8"),
  );
  const countries = Object.fromEntries(
    countrySource.countries.map((country) => [
      country.iso2,
      { name: country.name, point: point(country.centroid) },
    ]),
  );
  const admin1 = {};
  for (const source of manifest.admin1) {
    const collection = JSON.parse(
      await readFile(path.join(geographyRoot, source.path), "utf8"),
    );
    admin1[source.iso2] = Object.fromEntries(
      collection.features.map((feature) => [
        feature.properties.code,
        {
          name: feature.properties.name,
          point: point(feature.properties.centroid),
        },
      ]),
    );
  }
  return stable({
    schemaVersion: "1.0",
    sourceCommit: manifest.source.commit,
    countries,
    admin1,
  });
}

const generated = `${JSON.stringify(await build())}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error(
      "The server-side Travel geography policy is stale. Run the geography policy generator.",
    );
  }
  const digest = createHash("sha256").update(generated).digest("hex");
  console.log(`Verified server-side Travel geography policy ${digest.slice(0, 12)}.`);
} else {
  await writeFile(outputPath, generated, { mode: 0o644 });
}
