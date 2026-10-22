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
    /## speaker-bio\nAnish Shah builds agent infrastructure and evaluation workflows at Weights & Biases, part of CoreWeave\. His engineering contributions span the W&B MCP Server's deployment and reliability, ARIA's streaming and recovery, and controlled studies of agent behavior\. His talks use that work to explain how to trace failures, test tool interfaces, and decide what the evidence supports\.\n\nHis path spans programming education, computer-vision research, analytics, recommendation systems, and production ML\. He develops hands-on curricula and co-taught Fully Connected's Your Agent Learned to Cheat lab, where participants traced reward shortcuts and repaired the tests that missed them\. He brings concrete implementations, experimental limits, and the engineering decisions behind them into each session\.(?:\n|$)/u,
  );
  assert.match(
    source,
    /## speaker-topic-agent-systems\nAgent systems & tool interfaces/u,
  );
  assert.match(
    source,
    /## speaker-topic-agent-systems-description\nBuilding tool interfaces and recoverable conversations, with examples from MCP and ARIA\.(?:\n|$)/u,
  );
  assert.match(
    source,
    /## speaker-topic-evaluation-observability\nEvaluation & observability/u,
  );
  assert.match(
    source,
    /## speaker-topic-evaluation-observability-description\nTracing failures, testing judges, and checking what an agent evaluation can establish\.(?:\n|$)/u,
  );
  assert.match(
    source,
    /## speaker-topic-education-community\nTechnical education & workshops/u,
  );
  assert.match(
    source,
    /## speaker-topic-education-community-description\nHands-on labs in reward shortcuts, fine-tuning, and traced experiment loops\.(?:\n|$)/u,
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
    /## current-focus\nAt Weights & Biases, part of CoreWeave, I contribute to MCP deployment and reliability, ARIA's streaming and recovery, and evaluations that inspect agent behavior\. Lessons from that work become open-source tools, articles, courses, and hands-on workshops\.(?:\n|$)/u,
  );
  assert.match(source, /## career-heading\nHow the work developed\./u);
});
