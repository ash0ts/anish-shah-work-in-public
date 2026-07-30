export type DatabaseFailure =
  | "binding_unavailable"
  | "schema_unavailable"
  | "database_error";

export function classifyDatabaseError(error: unknown): DatabaseFailure {
  const message =
    error instanceof Error
      ? `${error.message}\n${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error);

  if (/binding|DB is unavailable|D1Database/i.test(message)) {
    return "binding_unavailable";
  }

  if (/no such table|no such column|has no column/i.test(message)) {
    return "schema_unavailable";
  }

  return "database_error";
}

export function publicDatabaseError(error: unknown): {
  code: DatabaseFailure;
  message: string;
} {
  const code = classifyDatabaseError(error);

  if (code === "binding_unavailable") {
    return {
      code,
      message: "The site database binding has not been provisioned.",
    };
  }

  if (code === "schema_unavailable") {
    return {
      code,
      message: "The site database exists, but its migration is not applied.",
    };
  }

  return {
    code,
    message: "The site database could not be read.",
  };
}
