import { createHash } from "node:crypto";

const BROKEN_MLOPS_URL =
  "https://home.mlops.community/en/public/blogs/how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-and-biases-2";
export const CORRECT_MLOPS_URL =
  "https://home.mlops.community/en/public/blogs/how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-biases-2";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

export function slugify(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[’']/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 88) || "untitled"
  );
}

export function unboundedSlug(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[’']/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
}

export function stableRouteSlug(value, stableId) {
  const full = unboundedSlug(value);
  if (full.length <= 88) return full;
  const prefix = full.slice(0, 81);
  const boundary = prefix.lastIndexOf("-");
  const readable = prefix.slice(0, boundary >= 56 ? boundary : 81).replace(/-+$/, "");
  return `${readable}-${shortHash(stableId, 6)}`;
}

export function normalizedTitle(value) {
  return unboundedSlug(value)
    .replace(/-(apple-podcasts|spotify|amazon-music|transcript-video-page|forem)$/, "")
    .replace(/-part-[0-9]+$/, "");
}

export function exactNormalizedTitle(value) {
  return unboundedSlug(value);
}

export function normalizeUrl(url) {
  if (!url) return "";
  const corrected = url.trim() === BROKEN_MLOPS_URL ? CORRECT_MLOPS_URL : url.trim();
  try {
    const parsed = new URL(corrected);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_")) parsed.searchParams.delete(key);
    }
    if (parsed.hostname === "youtu.be") {
      return `https://www.youtube.com/watch?v=${parsed.pathname.replace(/^\//, "")}`;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return corrected.replace(/\/+$/, "");
  }
}

export function canonicalPublicUrl(url) {
  if (!url) return "";
  return url.trim() === BROKEN_MLOPS_URL ? CORRECT_MLOPS_URL : url.trim();
}

export function datePrecision(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  if (/^\d{4}$/.test(value)) return "year";
  return "unknown";
}

export function dateBasis(row) {
  if (row.category === "event") return "event_date";
  if (row.category === "recording") {
    if (/\bupload date\b/i.test(row.notes)) return "upload_date";
    if (/\buploaded\b|\breplay published\b/i.test(row.notes)) return "event_date";
    return "publication_date";
  }
  if (row.date_start || row.year) return "publication_date";
  return "unknown";
}

const MONTHS = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].map((month, index) => [month, String(index + 1).padStart(2, "0")]),
);

export function parseAdditionalDates(row) {
  const dates = [];
  const pattern =
    /\b(uploaded|replay published)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/gi;
  for (const match of row.notes.matchAll(pattern)) {
    const year = match[4] || row.year;
    if (!year) continue;
    const value = `${year}-${MONTHS.get(match[2].toLowerCase())}-${String(match[3]).padStart(2, "0")}`;
    dates.push({
      label: match[1].toLowerCase() === "uploaded" ? "Recording uploaded" : "Replay published",
      start: value,
      end: null,
      precision: "day",
      basis: "upload_date",
    });
  }
  return dates;
}

export function parseDurationSeconds(notes) {
  const match = notes.match(/(?:^|;\s*)(\d{1,2}:\d{2}(?::\d{2})?)(?:;|$)/);
  if (!match) return null;
  const parts = match[1].split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

export function locationKind(label) {
  const value = label.toLowerCase();
  if (!value) return "unknown";
  if (/youtube|brighttalk|podcast|web|github|nvidia on-demand/.test(value)) return "platform";
  if (value.includes("hybrid") || (value.includes("online") && value.includes("/"))) return "hybrid";
  if (value.includes("online") || value.includes("virtual")) return "online";
  return "physical";
}

export function inferTopics(row) {
  const haystack = `${row.title} ${row.notes} ${row.organization}`.toLowerCase();
  const rules = [
    ["agents", /\bagent(?:s|ic)?\b|multi-agent/],
    ["mcp", /\bmcp\b|model context protocol/],
    ["evaluation", /\beval(?:s|uation|uating)?\b|llm judge/],
    ["fine-tuning", /fine[- ]?tun|prompt-tun|p-tun/],
    ["llms", /\bllm|large language model|gpt-|genai|generative ai/],
    ["mlops", /\bmlops\b|model monitoring|experiment tracking/],
    ["rag", /\brag\b|retrieval augmented/],
    ["weave", /\bweave\b/],
    ["multimodal", /multimodal/],
    ["open-source", /github|open.source|repository|pull request/],
    ["education", /course|workshop|class|instructor|tutorial/],
    ["community", /meetup|conference|podcast|community/],
    ["healthcare", /medical|healthcare|biomedical|drug discovery/],
    ["cloud", /azure|google cloud|snowflake|aws/],
  ];
  const topics = rules.filter(([, pattern]) => pattern.test(haystack)).map(([topic]) => topic);
  if (row.category === "course" && !topics.includes("education")) topics.push("education");
  return [...new Set(topics)].sort();
}

export function verificationFromConfidence(confidence) {
  if (confidence === "high") return "verified";
  if (confidence === "medium-high") return "corroborated";
  return "listed_unconfirmed";
}

export function makeOrganizationId(name) {
  return `org:${slugify(name)}`;
}

export function countBy(values, getKey) {
  const counts = new Map();
  for (const value of values) {
    const key = getKey(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
