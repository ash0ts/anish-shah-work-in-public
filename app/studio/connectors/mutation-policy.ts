export type ConnectorMutationAction = "save" | "refresh" | "disconnect";

/**
 * Credential and disconnect mutations need fresh server-owned connector state.
 * A manual refresh reconciles only when a new snapshot was accepted or an
 * already-running owner request may have completed in the meantime.
 */
export function connectorMutationShouldReconcile(
  action: ConnectorMutationAction,
  resultStatus: string | undefined,
): boolean {
  if (action !== "refresh") return true;
  return resultStatus === "complete" || resultStatus === "already_running";
}
