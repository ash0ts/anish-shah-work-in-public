import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  aboutSpeakerProfileFrom,
  parseSpeakerProfileManifest,
  speakerProfileManifest,
} = await tsImport("../lib/about-speaker.ts", import.meta.url);
const { workArchiveRecordsFrom } = await tsImport(
  "../lib/work-index.ts",
  import.meta.url,
);
const { workFacetsForRecord } = await tsImport(
  "../lib/work-facets.ts",
  import.meta.url,
);

const publicBundle = JSON.parse(
  await readFile(
    path.join(root, "content/public/anish-content.public.v1.json"),
    "utf8",
  ),
);

test("the speaker manifest is closed to the reviewed bucket and topics", () => {
  assert.deepEqual(speakerProfileManifest, {
    schemaVersion: "1.0",
    bucketId: "talks-programs",
    topicIds: [
      "agent-systems",
      "evaluation-observability",
      "education-community",
    ],
  });

  for (const value of [
    null,
    { ...speakerProfileManifest, bucketId: "products-open-source" },
    {
      ...speakerProfileManifest,
      topicIds: [...speakerProfileManifest.topicIds].reverse(),
    },
    { ...speakerProfileManifest, route: "/speaker" },
  ]) {
    assert.throws(
      () => parseSpeakerProfileManifest(value),
      /speaker_profile_manifest_invalid/u,
    );
  }
});

test("the speaker profile resolves reviewed labels and filtered Work links", () => {
  assert.deepEqual(aboutSpeakerProfileFrom(publicBundle), {
    bucketId: "talks-programs",
    workHref: "/work?bucket=talks-programs#work-index",
    topics: [
      {
        id: "agent-systems",
        label: "Agent systems & tool interfaces",
        description:
          "Building tool interfaces and recoverable conversations, with examples from MCP and ARIA.",
        href: "/work?bucket=talks-programs&topic=agent-systems#work-index",
      },
      {
        id: "evaluation-observability",
        label: "Evaluation & observability",
        description:
          "Tracing failures, testing judges, and checking what an agent evaluation can establish.",
        href:
          "/work?bucket=talks-programs&topic=evaluation-observability#work-index",
      },
      {
        id: "education-community",
        label: "Technical education & workshops",
        description:
          "Hands-on labs in reward shortcuts, fine-tuning, and traced experiment loops.",
        href:
          "/work?bucket=talks-programs&topic=education-community#work-index",
      },
    ],
  });
});

test("speaker topics disappear when their supporting Work is not public", () => {
  const supportingAgentIds = new Set(
    workArchiveRecordsFrom(publicBundle)
      .filter(
        (record) =>
          record.bucket === "talks-programs" &&
          workFacetsForRecord(record).theme.includes("agent-systems"),
      )
      .map((record) => record.id),
  );
  assert.ok(supportingAgentIds.size > 0, "the fixture should ground agent systems");

  const hiddenBundle = structuredClone(publicBundle);
  hiddenBundle.workGroups = hiddenBundle.workGroups.map((group) =>
    supportingAgentIds.has(group.id)
      ? { ...group, publicationState: "hidden" }
      : group,
  );

  const profile = aboutSpeakerProfileFrom(hiddenBundle);
  assert.equal(
    profile.topics.some(({ id }) => id === "agent-systems"),
    false,
  );
});

test("the speaker profile closes when no reviewed topic remains public", () => {
  const hiddenBundle = structuredClone(publicBundle);
  hiddenBundle.workGroups = hiddenBundle.workGroups.map((group) =>
    group.bucket === speakerProfileManifest.bucketId
      ? { ...group, publicationState: "hidden" }
      : group,
  );

  assert.deepEqual(aboutSpeakerProfileFrom(hiddenBundle).topics, []);
});
