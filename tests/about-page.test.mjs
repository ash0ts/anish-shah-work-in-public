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

test("the About copy deck carries one bounded, copyable speaker profile", async () => {
  const source = await readFile(
    new URL("../content/copy/pages/about.md", import.meta.url),
    "utf8",
  );
  assert.match(source, /## speaker-eyebrow\nSpeaker profile/u);
  assert.match(
    source,
    /## speaker-heading\nTalks grounded in the systems I build\./u,
  );
  assert.match(
    source,
    /## speaker-bio\nAnish Shah builds agent systems, evaluation and observability workflows, and technical education at Weights & Biases\. His talks turn lessons from those systems into practical patterns for tracing behavior, testing AI applications, and designing tool interfaces people can inspect and control\.(?:\n|$)/u,
  );
  assert.match(
    source,
    /## speaker-topic-agent-systems\nAgent systems & tool interfaces/u,
  );
  assert.match(
    source,
    /## speaker-topic-evaluation-observability\nEvaluation & observability/u,
  );
  assert.match(
    source,
    /## speaker-topic-education-community\nTechnical education & workshops/u,
  );
  assert.match(source, /## speaker-copy-cta\nCopy speaker profile/u);
  assert.match(source, /## speaker-linkedin-cta\nContact on LinkedIn/u);
});
