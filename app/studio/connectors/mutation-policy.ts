export type ConnectorMutationAction = "save" | "refresh" | "disconnect";

/**
 * Credential and disconnect mutations need fresh server-owned connector state.
 * Refreshes reconcile only when their result changes the lifecycle presented
 * by Studio. React preserves the exact local result announcement while the
 * server-owned row, summary, and next action are refreshed.
 */
export function connectorMutationShouldReconcile(
  action: ConnectorMutationAction,
  resultStatus: string | undefined,
): boolean {
  if (action !== "refresh") return true;
  return (
    resultStatus === "complete" ||
    resultStatus === "already_running" ||
    resultStatus === "not_due" ||
    resultStatus === "withheld" ||
    resultStatus === "failed" ||
    resultStatus === "setup_required"
  );
}
