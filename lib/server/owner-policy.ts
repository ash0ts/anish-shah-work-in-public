export type OwnerAuthorization =
  | { status: "allowed"; configured: true }
  | { status: "forbidden"; configured: true }
  | { status: "setup_required"; configured: false };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(",")
        .map((email) => email.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function evaluateOwnerAuthorization(
  email: string,
  rawOwnerEmails: string | undefined,
): OwnerAuthorization {
  const allowlist = parseOwnerEmails(rawOwnerEmails);
  if (allowlist.length === 0) {
    return { status: "setup_required", configured: false };
  }

  return allowlist.includes(email.trim().toLocaleLowerCase())
    ? { status: "allowed", configured: true }
    : { status: "forbidden", configured: true };
}
