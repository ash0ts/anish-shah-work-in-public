/**
 * Stable connector repository facade.
 *
 * Persistence responsibilities live in focused modules so callers retain one
 * import surface without coupling public routes to D1 query details.
 */
export type {
  ConnectorHealth,
  MyAnimeListOAuthCompletionResult,
  MyAnimeListOAuthStageResult,
  MyAnimeListOAuthStartResult,
  PublicSnapshotResult,
  RefreshResult,
  StudioOverview,
} from "./repository-contracts";

export {
  deleteConnectorCredential,
  saveConnectorCredential,
} from "./repository-credentials";
export {
  completeMyAnimeListOAuth,
  stageMyAnimeListOAuthCallback,
  startMyAnimeListOAuth,
} from "./repository-myanimelist-oauth";
export { getStudioOverview } from "./repository-overview";
export { refreshConnector } from "./repository-refresh";
export { pruneConnectorRetention } from "./repository-retention";
export { getPublicConnectorSnapshot } from "./repository-snapshots";
