import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { geoBounds, geoCentroid, geoEquirectangular, geoPath } from "d3-geo";
import sharp from "sharp";

const SOURCE_COMMIT = "f1890d9f152c896d250a77557a5751a93d494776";
const SOURCES = Object.freeze({
  countries: {
    file: "ne_50m_admin_0_countries.geojson",
    sha256: "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb",
  },
  regions: {
    file: "ne_50m_admin_1_states_provinces.geojson",
    sha256: "69a0e06e640b2d505858ae1cb63034e4677f3000b35a98e16312932b98c426b9",
  },
});
const WIDTH = 1024;
const HEIGHT = 512;
const root = process.cwd();
const destination = path.join(root, "public/assets/travel/geography");
const manifestPath = path.join(destination, "manifest.v1.json");
const sourceFlag = process.argv.indexOf("--source-dir");
const sourceDirectory =
  sourceFlag >= 0 && process.argv[sourceFlag + 1]
    ? path.resolve(process.argv[sourceFlag + 1])
    : path.join(root, ".cache/travel-geography");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function checkedSource(source) {
  const file = path.join(sourceDirectory, source.file);
  await access(file).catch(() => {
    throw new Error(
      `Missing ${source.file}. Download the pinned Natural Earth source into ${sourceDirectory}.`,
    );
  });
  const bytes = await readFile(file);
  if (sha256(bytes) !== source.sha256) {
    throw new Error(`${source.file} does not match the pinned source digest.`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

function paletteColor(id) {
  return [
    40 + (id % 7) * 30,
    40 + (Math.floor(id / 7) % 7) * 30,
    40 + (Math.floor(id / 49) % 5) * 40,
  ];
}

function validIso2(properties) {
  for (const candidate of [properties.ISO_A2, properties.ISO_A2_EH]) {
    if (typeof candidate === "string" && /^[A-Z]{2}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function prepareCountryFeatures(features) {
  const grouped = new Map();
  const excluded = [];

  for (const feature of features) {
    const iso2 = validIso2(feature.properties);
    if (!iso2) {
      excluded.push({
        adm0A3: feature.properties.ADM0_A3,
        name: feature.properties.NAME_EN || feature.properties.NAME,
        reason: "no-iso-3166-1-alpha-2",
      });
      continue;
    }

    const group = grouped.get(iso2) ?? [];
    group.push(feature);
    grouped.set(iso2, group);
  }

  const countries = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([iso2, group]) => {
      const primary =
        group.find((feature) => feature.properties.ISO_A2 === iso2) ?? group[0];
      const geometry = group.length === 1
        ? group[0].geometry
        : {
            type: "GeometryCollection",
            geometries: group.map((feature) => feature.geometry),
          };
      return {
        type: "Feature",
        properties: {
          iso2,
          iso3:
            primary.properties.ISO_A3 !== "-99"
              ? primary.properties.ISO_A3
              : primary.properties.ADM0_A3,
          name: primary.properties.NAME_EN || primary.properties.NAME,
          sourceFeatureCount: group.length,
        },
        geometry,
      };
    });

  if (countries.length > 254) {
    throw new Error("The country-ID texture supports at most 254 countries.");
  }
  if (new Set(countries.map((country) => country.properties.iso2)).size !== countries.length) {
    throw new Error("Country preparation produced duplicate ISO codes.");
  }

  return { countries, excluded };
}

async function countryTexture(features, textureName) {
  const projection = geoEquirectangular()
    .translate([WIDTH / 2, HEIGHT / 2])
    .scale(WIDTH / (2 * Math.PI))
    .precision(0.1);
  const renderPath = geoPath(projection);
  const palette = features.map((feature, index) => {
    const id = index + 1;
    return { id, color: paletteColor(id), path: renderPath(feature) ?? "" };
  });
  const shapes = palette
    .map(({ color, path: value }) =>
      `<path d="${value}" fill="rgb(${color.join(",")})"/>`,
    )
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#000"/>${shapes}</svg>`,
  );
  const raster = await sharp(svg)
    .resize(WIDTH, HEIGHT, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const ids = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let offset = 0; offset < raster.length; offset += 3) {
    const pixel = [raster[offset], raster[offset + 1], raster[offset + 2]];
    let bestId = 0;
    let bestDistance = pixel[0] ** 2 + pixel[1] ** 2 + pixel[2] ** 2;
    for (const entry of palette) {
      const distance =
        (pixel[0] - entry.color[0]) ** 2 +
        (pixel[1] - entry.color[1]) ** 2 +
        (pixel[2] - entry.color[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = entry.id;
      }
    }
    ids[offset] = bestId;
    ids[offset + 1] = 0;
    ids[offset + 2] = 0;
  }
  await sharp(ids, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(destination, textureName));
}

async function writeJson(relativePath, value) {
  const file = path.join(destination, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`);
}

async function verifyGenerated() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const generatorSha256 = sha256(await readFile(new URL(import.meta.url)));
  if (
    manifest.schemaVersion !== "1.0" ||
    manifest.source.commit !== SOURCE_COMMIT ||
    manifest.generatorSha256 !== generatorSha256 ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The generated Travel geography manifest is invalid.");
  }
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(destination, file.path));
    if (sha256(bytes) !== file.sha256) {
      throw new Error(`Generated geography asset ${file.path} changed.`);
    }
  }
  const countryFile = JSON.parse(
    await readFile(path.join(destination, manifest.countries.path), "utf8"),
  );
  if (
    !Array.isArray(countryFile.countries) ||
    countryFile.countries.length !== manifest.countries.count ||
    countryFile.countries.some(
      (country) =>
        !Number.isInteger(country.id) ||
        country.id < 1 ||
        country.id > 254 ||
        typeof country.iso2 !== "string" ||
        !/^[A-Z]{2}$/.test(country.iso2),
    ) ||
    new Set(countryFile.countries.map((country) => country.iso2)).size !==
      countryFile.countries.length
  ) {
    throw new Error("The generated country directory is invalid.");
  }
  console.log(`Verified ${manifest.files.length} first-party Travel geography assets.`);
}

if (process.argv.includes("--check")) {
  await verifyGenerated();
  process.exit(0);
}

const [countriesSource, regionsSource] = await Promise.all([
  checkedSource(SOURCES.countries),
  checkedSource(SOURCES.regions),
]);
const preparedCountries = prepareCountryFeatures(countriesSource.features);

await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, "admin1"), { recursive: true });
const suffix = SOURCE_COMMIT.slice(0, 12);
const textureName = `country-id.${suffix}.png`;
await countryTexture(preparedCountries.countries, textureName);

const countries = preparedCountries.countries.map((feature, index) => ({
  id: index + 1,
  iso2: feature.properties.iso2,
  iso3: feature.properties.iso3,
  name: feature.properties.name,
  centroid: geoCentroid(feature).map((value) => Number(value.toFixed(4))),
  bounds: geoBounds(feature).map((point) =>
    point.map((value) => Number(value.toFixed(4))),
  ),
}));
const countriesName = `countries.${suffix}.json`;
await writeJson(countriesName, { schemaVersion: "1.0", countries });

const regionFiles = [];
const byCountry = new Map();
for (const feature of regionsSource.features) {
  const iso2 = feature.properties.iso_a2;
  if (typeof iso2 !== "string" || !/^[A-Z]{2}$/.test(iso2)) continue;
  const list = byCountry.get(iso2) ?? [];
  list.push({
    type: "Feature",
    properties: {
      id: feature.properties.adm1_code,
      code: feature.properties.iso_3166_2 || feature.properties.code_hasc,
      name: feature.properties.name_en || feature.properties.name,
      type: feature.properties.type_en || feature.properties.type,
      centroid: geoCentroid(feature).map((value) => Number(value.toFixed(4))),
    },
    geometry: feature.geometry,
  });
  byCountry.set(iso2, list);
}
for (const [iso2, features] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
  const name = `admin1/${iso2.toLowerCase()}.${suffix}.json`;
  await writeJson(name, { type: "FeatureCollection", features });
  regionFiles.push({ iso2, path: name, count: features.length });
}

const assetPaths = [textureName, countriesName, ...regionFiles.map((file) => file.path)];
const files = [];
for (const relativePath of assetPaths) {
  const bytes = await readFile(path.join(destination, relativePath));
  files.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
}
await writeJson("manifest.v1.json", {
  schemaVersion: "1.0",
  generatedAt: "2026-08-03T00:00:00.000Z",
  generatorSha256: sha256(await readFile(new URL(import.meta.url))),
  source: {
    name: "Natural Earth",
    version: "5.1.2",
    commit: SOURCE_COMMIT,
    license: "Public domain",
    url: "https://www.naturalearthdata.com/about/terms-of-use/",
    files: SOURCES,
  },
  texture: { path: textureName, width: WIDTH, height: HEIGHT },
  countries: { path: countriesName, count: countries.length },
  excludedCountries: preparedCountries.excluded,
  admin1: regionFiles,
  files,
});
await verifyGenerated();
