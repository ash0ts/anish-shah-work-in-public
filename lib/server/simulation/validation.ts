import {
  SIMULATION_CURIOSITIES,
  SIMULATION_DIFFICULTIES,
  SIMULATION_MODES,
  SIMULATION_RESPONSE_MODES,
  SIMULATION_SCENE_IDS,
  SIMULATION_VISITOR_SIGNALS,
  type CreateSimulationSessionInput,
  type ModelTurnOutput,
  type SimulationTurnRequest,
} from "./contracts";
import {
  allowedEntityIds,
  isAllowedSimulationAction,
  sceneAllowsFreeText,
} from "./policy";

const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const URL_LIKE = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|ai)\b)/i;
const EMAIL_LIKE = /\b[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,24}\b/i;
const PHONE_LIKE = /(?:\+?\d[\s().-]*){8,}/;
const SECRET_LIKE =
  /(?:\b(?:bearer|authorization|password|api[_ -]?key|client[_ -]?secret)\b\s*[:=]?\s*\S+|\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,})/i;
const MARKUP_OR_URL = /(?:https?:\/\/|www\.|<[^>]*>|```|\[[^\]]*\]\([^)]*\))/i;
const NUMERIC_CLAIM = /(?:[$€£¥]\s*\d|\b\d+(?:[.,]\d+)*(?:\s*%|[KMB]\+?)?\b)/i;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

export function validateCreateSessionInput(
  value: unknown,
): ValidationResult<CreateSimulationSessionInput> {
  if (!exactObject(value, ["mode", "difficulty", "curiosity"])) {
    return {
      ok: false,
      code: "invalid_session_request",
      message: "Choose one supported mode, difficulty, and curiosity.",
    };
  }
  if (
    !SIMULATION_MODES.includes(
      value.mode as (typeof SIMULATION_MODES)[number],
    ) ||
    !SIMULATION_DIFFICULTIES.includes(
      value.difficulty as (typeof SIMULATION_DIFFICULTIES)[number],
    ) ||
    !SIMULATION_CURIOSITIES.includes(
      value.curiosity as (typeof SIMULATION_CURIOSITIES)[number],
    )
  ) {
    return {
      ok: false,
      code: "invalid_session_request",
      message: "Choose one supported mode, difficulty, and curiosity.",
    };
  }
  return { ok: true, value: value as CreateSimulationSessionInput };
}

function graphemeCount(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ).length;
  }
  return Array.from(value).length;
}

export function normalizeVisitorText(
  value: unknown,
): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) {
    return {
      ok: false,
      code: "invalid_visitor_text",
      message: "Use plain text without control characters.",
    };
  }
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || graphemeCount(normalized) > 280) {
    return {
      ok: false,
      code: "invalid_visitor_text",
      message: "Optional responses must contain between 1 and 280 characters.",
    };
  }
  if (
    URL_LIKE.test(normalized) ||
    EMAIL_LIKE.test(normalized) ||
    PHONE_LIKE.test(normalized) ||
    SECRET_LIKE.test(normalized)
  ) {
    return {
      ok: false,
      code: "sensitive_visitor_text",
      message:
        "Do not enter links, contact information, credentials, or other sensitive information.",
    };
  }
  return { ok: true, value: normalized };
}

export function validateSimulationTurnRequest(
  value: unknown,
): ValidationResult<SimulationTurnRequest> {
  if (
    !exactObject(value, ["requestId", "revision", "sceneId", "actionId"], [
      "freeText",
    ])
  ) {
    return {
      ok: false,
      code: "invalid_turn_request",
      message: "The turn request is malformed.",
    };
  }
  if (
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.revision > 12 ||
    typeof value.sceneId !== "string" ||
    value.sceneId === "complete" ||
    !SIMULATION_SCENE_IDS.includes(
      value.sceneId as (typeof SIMULATION_SCENE_IDS)[number],
    ) ||
    typeof value.actionId !== "string" ||
    !isAllowedSimulationAction(
      value.sceneId as SimulationTurnRequest["sceneId"],
      value.actionId,
    )
  ) {
    return {
      ok: false,
      code: "invalid_turn_request",
      message: "The turn request is malformed.",
    };
  }
  const text = normalizeVisitorText(value.freeText);
  if (!text.ok) return text;
  if (
    text.value &&
    !sceneAllowsFreeText(value.sceneId as SimulationTurnRequest["sceneId"])
  ) {
    return {
      ok: false,
      code: "free_text_not_allowed",
      message: "This encounter accepts authored actions only.",
    };
  }
  return {
    ok: true,
    value: {
      requestId: value.requestId,
      revision: value.revision,
      sceneId: value.sceneId as SimulationTurnRequest["sceneId"],
      actionId: value.actionId,
      ...(text.value ? { freeText: text.value } : {}),
    },
  };
}

export function validateModelTurnOutput(
  value: unknown,
  sceneId: Exclude<SimulationTurnRequest["sceneId"], "complete">,
  eligibleEntities: ReadonlySet<string> = allowedEntityIds(sceneId),
): ModelTurnOutput | null {
  if (
    !exactObject(value, [
      "opponentLine",
      "responseMode",
      "revealEntityIds",
      "visitorSignals",
    ])
  ) {
    return null;
  }
  if (
    typeof value.opponentLine !== "string" ||
    value.opponentLine.length < 1 ||
    value.opponentLine.length > 320 ||
    CONTROL_CHARACTER.test(value.opponentLine) ||
    MARKUP_OR_URL.test(value.opponentLine) ||
    NUMERIC_CLAIM.test(value.opponentLine) ||
    !SIMULATION_RESPONSE_MODES.includes(
      value.responseMode as (typeof SIMULATION_RESPONSE_MODES)[number],
    ) ||
    !Array.isArray(value.revealEntityIds) ||
    value.revealEntityIds.length > 2 ||
    !value.revealEntityIds.every((id) => typeof id === "string") ||
    new Set(value.revealEntityIds).size !== value.revealEntityIds.length ||
    !Array.isArray(value.visitorSignals) ||
    value.visitorSignals.length > 3 ||
    !value.visitorSignals.every(
      (signal) =>
        typeof signal === "string" &&
        SIMULATION_VISITOR_SIGNALS.includes(
          signal as (typeof SIMULATION_VISITOR_SIGNALS)[number],
        ),
    ) ||
    new Set(value.visitorSignals).size !== value.visitorSignals.length
  ) {
    return null;
  }
  if (!(value.revealEntityIds as string[]).every((id) => eligibleEntities.has(id))) {
    return null;
  }
  return {
    opponentLine: value.opponentLine.trim(),
    responseMode: value.responseMode as ModelTurnOutput["responseMode"],
    revealEntityIds: [...(value.revealEntityIds as string[])],
    visitorSignals: [
      ...(value.visitorSignals as ModelTurnOutput["visitorSignals"]),
    ],
  };
}
