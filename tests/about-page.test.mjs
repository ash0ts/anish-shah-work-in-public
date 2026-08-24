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
    /## speaker-bio\nAnish Shah builds agent systems, evaluation and observability workflows, and technical education at Weights & Biases\. His work focuses on what happens after an AI demo: tracing behavior, testing whether an application works, designing tool interfaces people can inspect, and deciding where human review belongs\.\n\nHis path spans programming education, computer-vision research, analytics, recommendation systems, production ML, customer-facing ML support, and MLOps growth\. That range shapes talks that connect system design to the practical decisions teams face when they build and operate AI applications\. He uses concrete implementations and public work to explain what worked, what failed, and which conclusions the evidence can actually support\.(?:\n|$)/u,
  );
  assert.match(
    source,
    /## speaker-topic-agent-systems\nAgent systems & tool interfaces/u,
  );
  assert.match(
    source,
    /## speaker-topic-agent-systems-description\nDesigning agent actions that are observable, bounded, and useful beyond a demo\./u,
  );
  assert.match(
    source,
    /## speaker-topic-evaluation-observability\nEvaluation & observability/u,
  );
  assert.match(
    source,
    /## speaker-topic-evaluation-observability-description\nUsing traces, tests, and human review to turn model behavior into engineering decisions\./u,
  );
  assert.match(
    source,
    /## speaker-topic-education-community\nTechnical education & workshops/u,
  );
  assert.match(
    source,
    /## speaker-topic-education-community-description\nTeaching fast-moving ML systems without sanding off the hard parts\./u,
  );
  assert.match(source, /## speaker-copy-cta\nCopy speaker profile/u);
  assert.match(source, /## speaker-work-cta\nBrowse talks and workshops/u);
  assert.match(source, /## speaker-linkedin-cta\nContact on LinkedIn/u);
});

test("the About narrative keeps the approved career progression", async () => {
  const source = await readFile(
    new URL("../content/copy/pages/about.md", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /## body\nTeaching programming and working in computer-vision research came first\. That led into analytics, data science, recommendation systems, and production ML at SAP\. The path wasn’t especially tidy, but the same problem kept showing up: making complex technical systems easier to inspect, improve, and use\./u,
  );
  assert.match(
    source,
    /## current-focus\nAt Weights & Biases, I moved from customer-facing ML support into MLOps growth and then agent systems\. The work now centers on evaluation and observability, tool interfaces, bounded execution, and human review\. Lessons that survive contact with real systems become open-source software, courses, talks, and workshops\./u,
  );
  assert.match(source, /## career-heading\nHow the work developed\./u);
});
