export const EDITABLE_RECORD_FIELDS = [
  "featured",
  "sortOrder",
  "approvedPublicWording",
  "caveat",
  "visibility",
] as const;

export type EditorialVisibility =
  | "public"
  | "review_required"
  | "private"
  | "excluded";

export type EditorialRecordPatch = {
  featured?: boolean;
  sortOrder?: number;
  approvedPublicWording?: string;
  caveat?: string;
  visibility?: EditorialVisibility;
};

export type PatchValidation =
  | { ok: true; value: EditorialRecordPatch; changedFields: string[] }
  | { ok: false; code: string; message: string };

const VISIBILITIES = new Set<EditorialVisibility>([
  "public",
  "review_required",
  "private",
  "excluded",
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "accesstoken",
  "ciphertext",
  "credential",
  "evidenceids",
  "exactvalue",
  "internalurl",
  "notes",
  "privateurl",
  "rawnotes",
  "refreshtoken",
  "secret",
  "sourcefile",
  "sourcerecord",
  "sourcesnapshots",
  "token",
  "value",
]);
const PRIVATE_STRING_PATTERNS = [
  /(?:^|[\\/])Users[\\/]/i,
  /\bfile:\/\//i,
  /\blocalhost(?::\d+)?\b/i,
  /https?:\/\/(?:[^/]+\.)?(?:notion\.so|hex\.tech|slack\.com)\b/i,
  /\b[A-Z0-9._%+-]+@(?:wandb\.com|weightsandbiases\.com)\b/i,
];
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function plainPublicText(
  value: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; code: string; message: string } {
  if (typeof value !== "string") {
    return {
      ok: false,
      code: "invalid_field",
      message: `${field} must be plain text.`,
    };
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    return {
      ok: false,
      code: "field_too_long",
      message: `${field} must be ${maxLength} characters or fewer.`,
    };
  }
  if (
    normalized.includes("<") ||
    normalized.includes(">") ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    return {
      ok: false,
      code: "raw_html_rejected",
      message: `${field} must not contain HTML or control characters.`,
    };
  }
  if (PRIVATE_STRING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      ok: false,
      code: "private_content_rejected",
      message: `${field} appears to contain private or internal data.`,
    };
  }

  return { ok: true, value: normalized };
}

export function validateEditorialPatch(value: unknown): PatchValidation {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {
      ok: false,
      code: "invalid_body",
      message: "A JSON object is required.",
    };
  }

  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return {
      ok: false,
      code: "empty_patch",
      message: "At least one editable field is required.",
    };
  }

  const allowed = new Set<string>(EDITABLE_RECORD_FIELDS);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "field_not_editable",
      message: `Unsupported editorial field: ${unknown.sort()[0]}.`,
    };
  }

  const patch: EditorialRecordPatch = {};
  if ("featured" in input) {
    if (typeof input.featured !== "boolean") {
      return {
        ok: false,
        code: "invalid_field",
        message: "featured must be true or false.",
      };
    }
    patch.featured = input.featured;
  }

  if ("sortOrder" in input) {
    if (
      typeof input.sortOrder !== "number" ||
      !Number.isInteger(input.sortOrder) ||
      input.sortOrder < -100_000 ||
      input.sortOrder > 100_000
    ) {
      return {
        ok: false,
        code: "invalid_field",
        message: "sortOrder must be an integer from -100000 to 100000.",
      };
    }
    patch.sortOrder = input.sortOrder;
  }

  if ("approvedPublicWording" in input) {
    const wording = plainPublicText(
      input.approvedPublicWording,
      "approvedPublicWording",
      600,
    );
    if (!wording.ok) return wording;
    patch.approvedPublicWording = wording.value;
  }

  if ("caveat" in input) {
    const caveat = plainPublicText(input.caveat, "caveat", 600);
    if (!caveat.ok) return caveat;
    patch.caveat = caveat.value;
  }

  if ("visibility" in input) {
    if (
      typeof input.visibility !== "string" ||
      !VISIBILITIES.has(input.visibility as EditorialVisibility)
    ) {
      return {
        ok: false,
        code: "invalid_field",
        message:
          "visibility must be public, review_required, private, or excluded.",
      };
    }
    patch.visibility = input.visibility as EditorialVisibility;
  }

  return { ok: true, value: patch, changedFields: keys.sort() };
}

export function validatePublicProjection(
  value: unknown,
  path = "record",
  depth = 0,
): { ok: true } | { ok: false; code: string; message: string } {
  if (depth > 12) {
    return {
      ok: false,
      code: "projection_too_deep",
      message: `${path} exceeds the public projection depth limit.`,
    };
  }

  if (typeof value === "string") {
    const text = plainPublicText(value, path, 20_000);
    return text.ok ? { ok: true } : text;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return { ok: true };
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) {
      return {
        ok: false,
        code: "projection_too_large",
        message: `${path} contains too many values.`,
      };
    }
    for (let index = 0; index < value.length; index += 1) {
      const result = validatePublicProjection(
        value[index],
        `${path}[${index}]`,
        depth + 1,
      );
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if (typeof value !== "object") {
    return {
      ok: false,
      code: "invalid_projection",
      message: `${path} contains an unsupported value.`,
    };
  }

  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_PUBLIC_KEYS.has(normalizedKey)) {
      return {
        ok: false,
        code: "private_field_rejected",
        message: `${path}.${key} is not allowed in a public snapshot.`,
      };
    }
    const result = validatePublicProjection(
      child,
      `${path}.${key}`,
      depth + 1,
    );
    if (!result.ok) return result;
  }

  return { ok: true };
}
