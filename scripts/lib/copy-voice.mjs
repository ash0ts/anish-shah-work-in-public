import {
  COPY_VOICE_PRINCIPLES,
  PLAY_OBJECT_LANGUAGE,
} from "../../lib/copy-voice-contract.ts";
import {
  COPY_PAGE_DEFINITIONS,
  WORK_GROUP_COPY_DEFINITIONS,
} from "../../lib/copy-contract.ts";

const HYPE = /\b(?:best[- ]in[- ]class|category[- ]defining|cutting[- ]edge|game[- ]changing|groundbreaking|revolutionary|turbocharge|unprecedented|unrivaled|world[- ]class|world(?:'s|’s)\s+best|thought\s+leader|number\s+one|10x)\b|#1/iu;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const GENERIC_OPENING = /^(?:a|an|the)\s+(?:public|technical|practical|hands-on)\b/iu;
const FILLER = /\b(?:emerging|landscape|ecosystem|leverage|impactful|innovative|seamless|robust|storyteller|thought\s+leadership)\b/giu;
const METRIC_NUMBER = /(?:[$€£]\s*\d|\b(?:USD|EUR|GBP)\s+\d|\b\d+(?:[,.]\d+)?\s*(?:%|percent\b|[KMB](?:\+)?(?=\s|$))|\b\d[\d,.]*\+?\s+(?:course\s+)?(?:enrollments?|registrants?|attendees?|users?|organizations?|accounts?|signups?|leads?|customers?|tool\s+calls?|pipeline|revenue|ARR)\b)/iu;
const METRIC_PERIOD = /\b(?:as\s+of|through|from|between|during|across\s+tracked|in\s+20\d{2}|20\d{2}\s*(?:[-–—]|to)\s*20\d{2})\b/iu;
const METRIC_LIMIT = /\b(?:internal\s+analytics|about|approximately|rounded|supported|same-day|program\s+reach|returned\s+order|enrollments?|not\s+(?:revenue|ARR|personal|unique|play\s+counts?))\b/iu;
const MEANINGLESS_SUMMARY = /^(?:(?:article\s+)?author|(?:webinar|workshop|conference|meetup)?\s*speaker|presenter|co-presenter|contributor|repository\s+owner|host|judge)\.?$|^(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|in-person\s+at|recording\s+uploaded|scheduled\s+event|exact\s+session\s+slot|no\s+replay\b)|\b(?:registration\s+record\s+retained|editorial\s+item)\b/iu;
const REPEATED_CORPUS_WORDS = new Set(["public", "technical", "work"]);
const DUPLICATE_SENTENCE_FIELDS = /(?:^|[-.])(?:body|description|fallback|headline|nonclaim-\d+|statement|summary)$/u;
const FIRST_PERSON_OPENING = /^(?:I|My)\b/u;
const FIRST_PERSON_TOKEN = /\b(?:I|me|my|mine|myself)\b/giu;
const ROLE_OVERLAP_STOPWORDS = new Set([
  "about",
  "across",
  "after",
  "again",
  "along",
  "also",
  "from",
  "into",
  "over",
  "that",
  "their",
  "through",
  "using",
  "with",
]);

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

function issue(severity, rule, key, message) {
  return { severity, rule, key, message };
}

export function countCopyWords(value) {
  return [...wordSegmenter.segment(value)].filter((part) => part.isWordLike).length;
}

export function copySentences(value) {
  return [...sentenceSegmenter.segment(value)]
    .map((part) => part.segment.trim())
    .filter(Boolean);
}

function normalizedSentence(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

function sourceFieldName(name) {
  return name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function definitionsByKey(definitions) {
  return new Map(definitions.map((definition) => [definition.key, definition]));
}

export function copyVoiceEntries(deck) {
  const entries = [];
  for (const [pageId, values] of Object.entries(deck.pages)) {
    const definitions = definitionsByKey(COPY_PAGE_DEFINITIONS[pageId]);
    for (const [field, value] of Object.entries(values)) {
      entries.push({
        key: `${pageId}.${field}`,
        surface: pageId,
        field,
        value,
        definition: definitions.get(field),
      });
    }
  }
  const workDefinitions = definitionsByKey(WORK_GROUP_COPY_DEFINITIONS);
  for (const [groupId, values] of Object.entries(deck.workGroups)) {
    for (const [name, value] of Object.entries(values)) {
      const field = sourceFieldName(name);
      entries.push({
        key: `${groupId}.${field}`,
        surface: "work-group",
        field,
        value,
        definition: workDefinitions.get(field),
      });
    }
  }
  return entries;
}

function repeatedWords(value) {
  const counts = new Map();
  for (const part of wordSegmenter.segment(value)) {
    if (!part.isWordLike) continue;
    const word = part.segment.toLocaleLowerCase("en-US");
    if (word.length < 5) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 3);
}

function auditEntry(entry, errors, warnings, corpusCounts) {
  const { key, surface, field, value, definition = {} } = entry;
  const words = countCopyWords(value);
  const sentences = copySentences(value);

  if (definition.minWords !== undefined && words < definition.minWords) {
    errors.push(
      issue(
        "error",
        "field-budget",
        key,
        `uses ${words} words; minimum is ${definition.minWords}`,
      ),
    );
  }
  if (definition.maxWords !== undefined && words > definition.maxWords) {
    errors.push(
      issue(
        "error",
        "field-budget",
        key,
        `uses ${words} words; maximum is ${definition.maxWords}`,
      ),
    );
  }
  if (
    definition.maxSentences !== undefined &&
    sentences.length > definition.maxSentences
  ) {
    errors.push(
      issue(
        "error",
        "field-budget",
        key,
        `uses ${sentences.length} sentences; maximum is ${definition.maxSentences}`,
      ),
    );
  }
  if (surface === "work-group" && field === "summary" && MEANINGLESS_SUMMARY.test(value)) {
    errors.push(
      issue(
        "error",
        "meaningless-summary",
        key,
        "must explain what the work did or made possible, not record an import note, role, time, or venue",
      ),
    );
  }
  if (
    surface === "work-group" &&
    field === "summary" &&
    FIRST_PERSON_OPENING.test(value)
  ) {
    errors.push(
      issue(
        "error",
        "artifact-first-summary",
        key,
        "must open with the artifact, mechanism, or result rather than I or My",
      ),
    );
  }
  if (
    surface === "work-group" &&
    field === "role-summary" &&
    FIRST_PERSON_OPENING.test(value)
  ) {
    errors.push(
      issue(
        "error",
        "role-phrase",
        key,
        "must be a concise role phrase rather than a first-person sentence",
      ),
    );
  }
  if (HYPE.test(value)) {
    errors.push(
      issue(
        "error",
        "unsupported-hype",
        key,
        "contains an unsupported superlative or promotional claim",
      ),
    );
  }
  const emojiCandidate = value.replace(/[©®™]/gu, "");
  if (definition.professional && (value.includes("!") || EMOJI.test(emojiCandidate))) {
    errors.push(
      issue(
        "error",
        "professional-tone",
        key,
        "cannot use exclamation marks or emoji on a professional public surface",
      ),
    );
  }
  if (
    METRIC_NUMBER.test(value) &&
    (!METRIC_PERIOD.test(value) || !METRIC_LIMIT.test(value))
  ) {
    errors.push(
      issue(
        "error",
        "unqualified-number",
        key,
        "contains a numeric or currency claim without both its period and an adjacent scope or limitation",
      ),
    );
  }

  if (GENERIC_OPENING.test(value)) {
    warnings.push(
      issue(
        "warning",
        "generic-opening",
        key,
        "opens generically; lead with the result, mechanism, or useful idea",
      ),
    );
  }
  const filler = [...new Set(value.match(FILLER) ?? [])];
  if (filler.length) {
    warnings.push(
      issue(
        "warning",
        "filler-language",
        key,
        `uses abstract language: ${filler.join(", ")}`,
      ),
    );
  }
  for (const sentence of sentences) {
    const sentenceWords = countCopyWords(sentence);
    if (sentenceWords > 30) {
      warnings.push(
        issue(
          "warning",
          "long-sentence",
          key,
          `contains a ${sentenceWords}-word sentence; aim for 30 words or fewer`,
        ),
      );
    }
  }
  for (const [word, count] of repeatedWords(value)) {
    warnings.push(
      issue(
        "warning",
        "local-repetition",
        key,
        `repeats “${word}” ${count} times`,
      ),
    );
  }
  for (const part of wordSegmenter.segment(value)) {
    if (!part.isWordLike) continue;
    const word = part.segment.toLocaleLowerCase("en-US");
    if (REPEATED_CORPUS_WORDS.has(word)) {
      corpusCounts.set(word, (corpusCounts.get(word) ?? 0) + 1);
    }
  }
}

function validatePlayObjectNames(entries, errors) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  for (const [object, requirement] of Object.entries(PLAY_OBJECT_LANGUAGE)) {
    const key = `play.${object}-title`;
    const entry = byKey.get(key);
    if (entry && entry.value !== requirement.objectName) {
      errors.push(
        issue(
          "error",
          "play-object-name",
          key,
          `${requirement.category} must use the literal room-object name “${requirement.objectName}”`,
        ),
      );
    }
  }
}

function validateDuplicateSentences(entries, errors) {
  const seen = new Map();
  for (const entry of entries) {
    if (!DUPLICATE_SENTENCE_FIELDS.test(entry.field)) continue;
    if (entry.field === "role-summary") continue;
    if (entry.field === "seo-description") continue;
    for (const sentence of copySentences(entry.value)) {
      if (countCopyWords(sentence) < 6) continue;
      const normalized = normalizedSentence(sentence);
      const earlier = seen.get(normalized);
      if (earlier) {
        errors.push(
          issue(
            "error",
            "duplicate-sentence",
            entry.key,
            `duplicates a sentence already used in ${earlier}`,
          ),
        );
      } else {
        seen.set(normalized, entry.key);
      }
    }
  }
}

function meaningfulRoleTokens(value) {
  return new Set(
    (value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}-]+/gu) ?? [])
      .filter((token) => token.length >= 4)
      .filter((token) => !ROLE_OVERLAP_STOPWORDS.has(token)),
  );
}

function validateWorkGroupSummaryRolePairs(entries, warnings) {
  const summaries = new Map(
    entries
      .filter(
        (entry) => entry.surface === "work-group" && entry.field === "summary",
      )
      .map((entry) => [entry.key.slice(0, -".summary".length), entry]),
  );
  for (const role of entries.filter(
    (entry) =>
      entry.surface === "work-group" && entry.field === "role-summary",
  )) {
    if (!FIRST_PERSON_OPENING.test(role.value)) continue;
    const prefix = role.key.slice(0, -".role-summary".length);
    const summary = summaries.get(prefix);
    if (!summary) continue;
    const summaryTokens = meaningfulRoleTokens(summary.value);
    const overlap = [...meaningfulRoleTokens(role.value)].filter((token) =>
      summaryTokens.has(token),
    );
    if (overlap.length < 2) continue;
    warnings.push(
      issue(
        "warning",
        "summary-role-duplication",
        role.key,
        `repeats the summary instead of naming the role: ${overlap.join(", ")}`,
      ),
    );
  }
}

function countFirstPerson(entries) {
  return entries.reduce(
    (total, entry) => total + (entry.value.match(FIRST_PERSON_TOKEN) ?? []).length,
    0,
  );
}

function entriesForSurface(entries, surface, include) {
  return entries.filter(
    (entry) => entry.surface === surface && include(entry.field),
  );
}

function validatePublicSurfaceBudgets(entries, errors) {
  const firstPersonBudgets = [
    {
      key: "home-visible",
      maximum: 1,
      entries: entriesForSurface(
        entries,
        "home",
        (field) => !field.startsWith("seo-"),
      ),
    },
    {
      key: "about-visible",
      maximum: 3,
      entries: entriesForSurface(
        entries,
        "about",
        (field) => !field.startsWith("seo-"),
      ),
    },
    {
      key: "work-overview",
      maximum: 0,
      entries: entriesForSurface(
        entries,
        "work",
        (field) => !field.startsWith("detail-"),
      ),
    },
    {
      key: "sources-visible",
      maximum: 0,
      entries: entriesForSurface(
        entries,
        "sources",
        (field) => !field.startsWith("seo-"),
      ),
    },
    {
      key: "play-object-descriptions",
      maximum: 0,
      entries: entriesForSurface(
        entries,
        "play",
        (field) => /^(?:watch|read|listen|collect|play|move|travel)-description$/u.test(field),
      ),
    },
  ];

  for (const budget of firstPersonBudgets) {
    const count = countFirstPerson(budget.entries);
    if (count <= budget.maximum) continue;
    errors.push(
      issue(
        "error",
        "first-person-budget",
        budget.key,
        `uses ${count} first-person token${count === 1 ? "" : "s"}; maximum is ${budget.maximum}`,
      ),
    );
  }

  const wordBudgets = [
    {
      key: "about-body",
      maximum: 55,
      entries: entriesForSurface(
        entries,
        "about",
        (field) => field === "body" || field === "current-focus",
      ),
    },
    {
      key: "work-masthead",
      maximum: 25,
      entries: entriesForSurface(
        entries,
        "work",
        (field) => field.startsWith("masthead-"),
      ),
    },
    {
      key: "sources-intro-and-rules",
      maximum: 70,
      entries: entriesForSurface(
        entries,
        "sources",
        (field) => field.startsWith("intro-") || field.startsWith("rules-") || /^rule-[134]-/u.test(field),
      ),
    },
  ];

  for (const budget of wordBudgets) {
    const count = budget.entries.reduce(
      (total, entry) => total + countCopyWords(entry.value),
      0,
    );
    if (count <= budget.maximum) continue;
    errors.push(
      issue(
        "error",
        "surface-word-budget",
        budget.key,
        `uses ${count} words; maximum is ${budget.maximum}`,
      ),
    );
  }
}

export function auditCopyVoice(entries) {
  const errors = [];
  const warnings = [];
  const corpusCounts = new Map();
  for (const entry of entries) auditEntry(entry, errors, warnings, corpusCounts);
  validatePlayObjectNames(entries, errors);
  validateDuplicateSentences(entries, errors);
  validateWorkGroupSummaryRolePairs(entries, warnings);
  validatePublicSurfaceBudgets(entries, errors);

  const corpusThresholds = { public: 12, technical: 10, work: 12 };
  for (const [word, maximum] of Object.entries(corpusThresholds)) {
    const count = corpusCounts.get(word) ?? 0;
    if (count > maximum) {
      warnings.push(
        issue(
          "warning",
          "corpus-repetition",
          "copy-deck",
          `uses “${word}” ${count} times; review whether concrete nouns can replace it`,
        ),
      );
    }
  }

  const sort = (left, right) =>
    left.key.localeCompare(right.key) || left.rule.localeCompare(right.rule);
  errors.sort(sort);
  warnings.sort(sort);
  return {
    errors,
    warnings,
    principles: [...COPY_VOICE_PRINCIPLES],
  };
}

export function formatCopyVoiceIssue(entry) {
  return `${entry.severity.toUpperCase()} ${entry.rule} ${entry.key}: ${entry.message}`;
}

export function assertCopyVoice(report) {
  if (!report.errors.length) return;
  throw new Error(
    `Copy voice validation failed with ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:\n${report.errors.map(formatCopyVoiceIssue).join("\n")}`,
  );
}
