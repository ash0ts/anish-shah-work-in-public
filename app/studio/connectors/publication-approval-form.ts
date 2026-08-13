export type ConnectorApprovalReferenceSource =
  | "unified"
  | "legacy_discogs"
  | null;

function canonicalDateInput(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const startOfDay = `${value}T00:00:00.000Z`;
  try {
    return new Date(startOfDay).toISOString() === startOfDay ? value : null;
  } catch {
    return null;
  }
}

export function approvalDateAtStartOfDayUtc(value: unknown): string | null {
  const date = canonicalDateInput(value);
  return date ? `${date}T00:00:00.000Z` : null;
}

export function approvalExpiryAtEndOfDayUtc(value: unknown): string | null {
  const date = canonicalDateInput(value);
  return date ? `${date}T23:59:59.000Z` : null;
}

export function connectorApprovalReferenceField(
  source: ConnectorApprovalReferenceSource,
): {
  required: boolean;
  placeholder: string;
  legacyHelp: string | null;
} {
  if (source === "unified") {
    return {
      required: false,
      placeholder: "Stored encrypted — leave blank to keep",
      legacyHelp: null,
    };
  }
  if (source === "legacy_discogs") {
    return {
      required: true,
      placeholder: "New reference required",
      legacyHelp:
        "Enter the permission reference again. The legacy reference cannot be reused.",
    };
  }
  return {
    required: true,
    placeholder: "Private reference",
    legacyHelp: null,
  };
}
