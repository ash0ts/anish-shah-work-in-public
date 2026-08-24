import manifestJson from "@/content/presentation/speaker-profile.v1.json" with {
  type: "json",
};
import { SITE_COPY } from "@/lib/copy";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import {
  workFacetsForRecord,
  type ThemeFacetId,
} from "@/lib/work-facets";
import type { AnishContentBundle } from "@/types/content";

const speakerTopicIds = [
  "agent-systems",
  "evaluation-observability",
  "education-community",
] as const satisfies readonly ThemeFacetId[];

export type SpeakerProfileTopicId = (typeof speakerTopicIds)[number];

export type SpeakerProfileManifest = {
  schemaVersion: "1.0";
  bucketId: "talks-programs";
  topicIds: [
    "agent-systems",
    "evaluation-observability",
    "education-community",
  ];
};

export type AboutSpeakerTopic = {
  id: SpeakerProfileTopicId;
  label: string;
  description: string;
  href: string;
};

export type AboutSpeakerProfile = {
  bucketId: "talks-programs";
  workHref: string;
  topics: AboutSpeakerTopic[];
};

const topicCopyKeys = {
  "agent-systems": {
    label: "speaker-topic-agent-systems",
    description: "speaker-topic-agent-systems-description",
  },
  "evaluation-observability": {
    label: "speaker-topic-evaluation-observability",
    description: "speaker-topic-evaluation-observability-description",
  },
  "education-community": {
    label: "speaker-topic-education-community",
    description: "speaker-topic-education-community-description",
  },
} as const satisfies Record<
  SpeakerProfileTopicId,
  {
    label: keyof typeof SITE_COPY.about;
    description: keyof typeof SITE_COPY.about;
  }
>;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

/**
 * Keeps the public speaker navigation closed to the reviewed Talks/Programs
 * bucket and three presentation topics. The manifest cannot introduce a route,
 * arbitrary query parameter, or executable module.
 */
export function parseSpeakerProfileManifest(
  value: unknown,
): SpeakerProfileManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("speaker_profile_manifest_invalid");
  }

  const manifest = value as Record<string, unknown>;
  if (
    !exactKeys(manifest, ["schemaVersion", "bucketId", "topicIds"]) ||
    manifest.schemaVersion !== "1.0" ||
    manifest.bucketId !== "talks-programs" ||
    !Array.isArray(manifest.topicIds) ||
    manifest.topicIds.length !== speakerTopicIds.length ||
    manifest.topicIds.some(
      (topicId, index) => topicId !== speakerTopicIds[index],
    )
  ) {
    throw new Error("speaker_profile_manifest_invalid");
  }

  return {
    schemaVersion: "1.0",
    bucketId: "talks-programs",
    topicIds: [...speakerTopicIds],
  };
}

export const speakerProfileManifest =
  parseSpeakerProfileManifest(manifestJson);

function speakerTopicHref(topicId: SpeakerProfileTopicId): string {
  const parameters = new URLSearchParams({
    bucket: speakerProfileManifest.bucketId,
    topic: topicId,
  });
  return `/work?${parameters.toString()}#work-index`;
}

function speakerWorkHref(): string {
  const parameters = new URLSearchParams({
    bucket: speakerProfileManifest.bucketId,
  });
  return `/work?${parameters.toString()}#work-index`;
}

/**
 * Resolves speaker themes only when the active sanitized publication contains
 * at least one visible Talks/Programs record for that theme. Copy supplies the
 * reader-facing labels; canonical Work data decides whether each link exists.
 */
export function aboutSpeakerProfileFrom(
  bundle: AnishContentBundle,
): AboutSpeakerProfile {
  const visibleTalks = workArchiveRecordsFrom(bundle).filter(
    (record) => record.bucket === speakerProfileManifest.bucketId,
  );

  return {
    bucketId: speakerProfileManifest.bucketId,
    workHref: speakerWorkHref(),
    topics: speakerProfileManifest.topicIds.flatMap((topicId) => {
      const visible = visibleTalks.some((record) =>
        workFacetsForRecord(record).theme.includes(topicId),
      );
      if (!visible) return [];
      return [
        {
          id: topicId,
          label: SITE_COPY.about[topicCopyKeys[topicId].label],
          description:
            SITE_COPY.about[topicCopyKeys[topicId].description],
          href: speakerTopicHref(topicId),
        },
      ];
    }),
  };
}
