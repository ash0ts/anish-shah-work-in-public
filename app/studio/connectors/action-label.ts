import type { StudioConnectorView } from "@/lib/server/connectors";
import { formatTimestamp } from "./helpers";

export function studioConnectorActionLabel(
  view: StudioConnectorView,
): string {
  switch (view.primaryAction) {
    case "resolve_environment":
      return "Finish environment setup";
    case "connect":
      return view.provider === "strava" ? "Save profile" : "Connect";
    case "continue_authorization":
      return view.connection.canReuseOAuthClient
        ? "Continue authorization"
        : "Restart authorization";
    case "reauthorize":
      return "Authorize again";
    case "replace_credential":
      return "Replace credential";
    case "record_public_permission":
      return view.permission.status === "disabled"
        ? "Restore public access"
        : view.permission.status === "expired" ||
            view.permission.status === "legacy"
          ? "Renew permission"
          : "Allow public use";
    case "sync":
      return view.provider === "spotify" || view.provider === "discogs"
        ? "Sync"
        : "Sync and publish";
    case "publish":
      return "Publish";
    case "refresh":
      return "Refresh now";
    case "retry":
      return "Try again";
    case "wait_retry":
      return view.snapshot.retryNotBefore
        ? `Retry after ${formatTimestamp(view.snapshot.retryNotBefore)}`
        : "Wait before retrying";
    case "none":
      return "Review";
  }
}
