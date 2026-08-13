import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the About career manifest declares one official mark and two reviewed fallbacks", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../content/presentation/career.v1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    manifest.phases.map(({ id, period, organization, mark }) => ({
      id,
      period,
      organization,
      mark: mark.kind,
    })),
    [
      {
        id: "weights-and-biases",
        period: "2021–Now",
        organization: "Weights & Biases",
        mark: "official",
      },
      {
        id: "sap-and-brilliant-hire",
        period: "2017–2021",
        organization: "SAP & Brilliant Hire by SAP",
        mark: "typographic",
      },
      {
        id: "temple-university",
        period: "2016–2019",
        organization: "Temple University",
        mark: "typographic",
      },
    ],
  );
  assert(
    manifest.phases.every(({ mark }) =>
      mark.kind === "official"
        ? mark.brandAssetId === "weights-biases"
        : mark.brandAssetId === null,
    ),
  );
});

test("the About source deck excludes resume-level contact and credential detail", async () => {
  const source = await readFile(
    new URL("../content/copy/pages/about.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\/Users\/|Profile\.pdf|mailto:/iu);
  assert.doesNotMatch(source, /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u);
  assert.doesNotMatch(source, /\b\d{3}[-.)\s]+\d{3}[-.\s]+\d{4}\b/u);
  assert.doesNotMatch(source, /credential\s+id|certificate\s+id|street\s+address/iu);
});
