import { getStravaPublicConfig } from "../strava-config";
import { getDiscogsPresentationConfig } from "./discogs-presentation";
import {
  connectorPublicationGate,
  CONNECTOR_PUBLICATION_APPROVAL_SCOPES,
  getConnectorPublicationApprovalOverview,
  PUBLIC_CONNECTOR_PROVIDERS,
  type ConnectorPublicationApprovalOverview,
  type ConnectorPublicationApprovalScope,
  type ConnectorPublicationApprovalSummary,
  type PublicConnectorProvider,
} from "./publication-approval";
import { getStudioOverview } from "./repository-overview";
import type { ConnectorHealth } from "./repository-contracts";
import type { StudioOverview } from "./repository-contracts";
import { getSpotifyPresentationConfig } from "./spotify-presentation";

export type StudioConnectorPrimaryAction =
  | "resolve_environment"
  | "connect"
  | "continue_authorization"
  | "reauthorize"
  | "replace_credential"
  | "record_public_permission"
  | "sync"
  | "publish"
  | "refresh"
  | "retry"
  | "wait_retry"
  | "none";

export type StudioConnectorView = {
  provider: PublicConnectorProvider;
  stream: "Watch" | "Read" | "Listen" | "Collect" | "Play" | "Move";
  label: string;
  configured: boolean;
  configurationRevision: string | null;
  publicState: "live" | "private" | "needs_action" | "not_connected";
  primaryAction: StudioConnectorPrimaryAction;
  connection: {
    status:
      | "not_connected"
      | "authorization_pending"
      | "connected"
      | "reauthorization_required"
      | "credential_replacement_required"
      | "setup_required";
    canReuseOAuthClient: boolean;
  };
  permission: {
    status:
      | "approved"
      | "missing"
      | "disabled"
      | "expired"
      | "legacy"
      | "setup_required";
    gate:
      | "allowed_approved"
      | "allowed_grandfathered"
      | "withheld"
      | "setup_required";
    approvedAt: string | null;
    expiresAt: string | null;
    referenceStored: boolean;
    approval: ConnectorPublicationApprovalSummary | null;
    missingScopes: ConnectorPublicationApprovalScope[];
  };
  snapshot: {
    status: "none" | "saved" | "syncing" | "withheld";
    itemCount: number | null;
    lastSyncedAt: string | null;
    stale: boolean;
    lastErrorCode: string | null;
    retryNotBefore: string | null;
  };
  presentation: {
    status: "not_applicable" | "published" | "private" | "setup_required";
  };
  strava: {
    embedStatus: "available" | "unavailable";
    checkedAt: string | null;
    updatedAt: string | null;
  } | null;
};

export type StudioCollectionsView = {
  status: "ready" | "setup_required";
  summary: {
    live: number;
    needsAction: number;
    private: number;
    notConnected: number;
  };
  permissionSetup: {
    visible: boolean;
    readyCount: number;
    totalConfigured: number;
    missingProviders: PublicConnectorProvider[];
    activationReady: boolean;
  };
  approvals: ConnectorPublicationApprovalOverview | null;
  connectors: StudioConnectorView[];
};

const providerMeta: Record<
  PublicConnectorProvider,
  { stream: StudioConnectorView["stream"]; label: string }
> = {
  myanimelist: { stream: "Watch", label: "MyAnimeList" },
  hardcover: { stream: "Read", label: "Hardcover" },
  spotify: { stream: "Listen", label: "Spotify" },
  discogs: { stream: "Collect", label: "Discogs" },
  steam: { stream: "Play", label: "Steam" },
  strava: { stream: "Move", label: "Strava" },
};

type GateResult = Awaited<ReturnType<typeof connectorPublicationGate>>;

function permissionState(
  approval: ConnectorPublicationApprovalSummary | null,
  missingScopes: ConnectorPublicationApprovalScope[],
  now: number,
): StudioConnectorView["permission"]["status"] {
  if (!approval) return "missing";
  if (approval.source === "legacy_discogs") return "legacy";
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt =
    approval.expiresAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(approval.expiresAt);
  const hasRequiredScopes = CONNECTOR_PUBLICATION_APPROVAL_SCOPES.every(
    (scope) => approval.scopes.includes(scope),
  );
  if (
    !Number.isFinite(approvedAt) ||
    approvedAt > now ||
    expiresAt <= now ||
    !hasRequiredScopes
  ) {
    return "expired";
  }
  if (!approval.enabled) return "disabled";
  if (!approval.active || missingScopes.length > 0) return "expired";
  return "approved";
}

function connectionState(
  health: ConnectorHealth | null,
  configured: boolean,
): StudioConnectorView["connection"]["status"] {
  if (!health) return configured ? "connected" : "not_connected";
  if (health.status === "authorization_required") return "authorization_pending";
  const credentialRejected =
    health.lastErrorCode === "credential_expired" ||
    health.lastErrorCode === "credential_invalid";
  const oauthProvider =
    health.provider === "myanimelist" ||
    health.provider === "spotify" ||
    health.provider === "discogs";
  if (
    health.status === "reauthorization_required" ||
    (credentialRejected && oauthProvider)
  ) {
    return "reauthorization_required";
  }
  if (credentialRejected) return "credential_replacement_required";
  if (!configured) return "not_connected";
  if (health.status === "setup_required") return "setup_required";
  return "connected";
}

function snapshotState(
  health: ConnectorHealth | null,
): StudioConnectorView["snapshot"]["status"] {
  if (!health) return "none";
  if (health.status === "syncing") return "syncing";
  if (health.status === "visibility_required") return "withheld";
  return health.itemCount === null ? "none" : "saved";
}

function primaryAction(input: {
  provider: PublicConnectorProvider;
  configured: boolean;
  connection: StudioConnectorView["connection"]["status"];
  permission: StudioConnectorView["permission"]["status"];
  gate: StudioConnectorView["permission"]["gate"];
  snapshot: StudioConnectorView["snapshot"]["status"];
  presentation: StudioConnectorView["presentation"]["status"];
  retryNotBefore: string | null;
  lastErrorCode: string | null;
  stravaConfigured: boolean;
  environmentReady: boolean;
  now: number;
}): StudioConnectorPrimaryAction {
  if (!input.environmentReady) return "resolve_environment";
  if (
    input.connection === "setup_required" ||
    input.permission === "setup_required" ||
    input.presentation === "setup_required"
  ) {
    return "resolve_environment";
  }
  if (!input.configured && !input.stravaConfigured) {
    return input.connection === "authorization_pending"
      ? "continue_authorization"
      : "connect";
  }
  if (input.connection === "reauthorization_required") return "reauthorize";
  if (input.connection === "credential_replacement_required") {
    return "replace_credential";
  }
  if (
    input.permission !== "approved" ||
    input.gate === "allowed_grandfathered" ||
    input.gate === "withheld"
  ) {
    return "record_public_permission";
  }
  if (input.provider === "strava") return "none";
  if (input.snapshot === "syncing") return "none";
  if (input.snapshot === "none" || input.snapshot === "withheld") {
    if (input.retryNotBefore && Date.parse(input.retryNotBefore) > input.now) {
      return "wait_retry";
    }
    return input.lastErrorCode ? "retry" : "sync";
  }
  if (input.presentation === "private") return "publish";
  if (input.retryNotBefore && Date.parse(input.retryNotBefore) > input.now) {
    return "wait_retry";
  }
  if (input.lastErrorCode) return "retry";
  return "refresh";
}

function needsOwnerAction(action: StudioConnectorPrimaryAction): boolean {
  return action !== "none" && action !== "refresh";
}

export function composeStudioConnectorViews(input: {
  health: ConnectorHealth[];
  approvals: ConnectorPublicationApprovalOverview;
  gates: Record<PublicConnectorProvider, GateResult>;
  spotifyPublished: boolean | "setup_required";
  discogsPublished: boolean | "setup_required";
  strava:
    | {
        configured: true;
        embedStatus: "available" | "unavailable";
        checkedAt: string | null;
        updatedAt: string;
      }
    | { configured: false };
  setupReady?: Partial<Record<PublicConnectorProvider, boolean>>;
  now?: number;
}): StudioCollectionsView {
  const now = input.now ?? Date.now();
  const healthByProvider = new Map(input.health.map((item) => [item.provider, item]));
  const approvalByProvider = new Map(
    input.approvals.providers.map((item) => [item.provider, item]),
  );

  const connectors = PUBLIC_CONNECTOR_PROVIDERS.map((provider) => {
    const health = provider === "strava" ? null : healthByProvider.get(provider) ?? null;
    const approvalEntry = approvalByProvider.get(provider);
    const approval = approvalEntry?.approval ?? null;
    const missingScopes = approvalEntry?.missingScopes ?? [
      "public_display",
      "retain_last_known_good",
    ];
    const configured = provider === "strava" ? input.strava.configured : Boolean(health?.configured);
    const permission = permissionState(approval, missingScopes, now);
    const gateResult = input.gates[provider];
    const gate: StudioConnectorView["permission"]["gate"] =
      gateResult.status === "setup_required"
        ? "setup_required"
        : gateResult.status === "withheld"
          ? "withheld"
          : permission === "approved"
            ? "allowed_approved"
            : "allowed_grandfathered";
    const connection = connectionState(health, configured);
    const snapshot = provider === "strava" ? "none" : snapshotState(health);
    const presentation: StudioConnectorView["presentation"]["status"] =
      provider === "spotify"
        ? input.spotifyPublished === "setup_required"
          ? "setup_required"
          : input.spotifyPublished
            ? "published"
            : "private"
        : provider === "discogs"
          ? input.discogsPublished === "setup_required"
            ? "setup_required"
            : input.discogsPublished
              ? "published"
              : "private"
          : "not_applicable";
    const action = primaryAction({
      provider,
      configured,
      connection,
      permission,
      gate,
      snapshot,
      presentation,
      retryNotBefore: health?.retryNotBefore ?? null,
      lastErrorCode: health?.lastErrorCode ?? null,
      stravaConfigured: provider === "strava" && input.strava.configured,
      environmentReady: input.setupReady?.[provider] ?? true,
      now,
    });
    const hasPublicContent =
      configured &&
      gate !== "withheld" &&
      gate !== "setup_required" &&
      (provider === "strava"
        ? input.strava.configured
        : snapshot === "saved" && presentation !== "private" && presentation !== "setup_required");
    const publicState: StudioConnectorView["publicState"] =
      action === "resolve_environment" || connection === "setup_required"
        ? "needs_action"
        : !configured
          ? "not_connected"
          : hasPublicContent
            ? "live"
            : action === "retry" ||
                action === "wait_retry" ||
                connection === "reauthorization_required" ||
                connection === "credential_replacement_required"
              ? "needs_action"
              : "private";

    return {
      provider,
      ...providerMeta[provider],
      configured,
      configurationRevision: approvalEntry?.configurationRevision ?? null,
      publicState,
      primaryAction: action,
      connection: {
        status: connection,
        canReuseOAuthClient: health?.canReuseOAuthClient ?? false,
      },
      permission: {
        status: gate === "setup_required" ? "setup_required" : permission,
        gate,
        approvedAt: approval?.approvedAt ?? null,
        expiresAt: approval?.expiresAt ?? null,
        referenceStored: Boolean(approval?.referenceStored),
        approval,
        missingScopes,
      },
      snapshot: {
        status: snapshot,
        itemCount: health?.itemCount ?? null,
        lastSyncedAt:
          provider === "strava" && input.strava.configured
            ? input.strava.updatedAt
            : health?.lastSyncedAt ?? null,
        stale: health?.status === "stale",
        lastErrorCode: health?.lastErrorCode ?? null,
        retryNotBefore: health?.retryNotBefore ?? null,
      },
      presentation: { status: presentation },
      strava:
        provider === "strava" && input.strava.configured
          ? {
              embedStatus: input.strava.embedStatus,
              checkedAt: input.strava.checkedAt,
              updatedAt: input.strava.updatedAt,
            }
          : null,
    } satisfies StudioConnectorView;
  });

  const summary = {
    live: connectors.filter((item) => item.publicState === "live").length,
    // Attention is intentionally independent of public state. A provider can
    // remain live under the report-only grandfather while still requiring its
    // permission record before the one-time policy activation.
    needsAction: connectors.filter((item) => needsOwnerAction(item.primaryAction)).length,
    private: connectors.filter((item) => item.publicState === "private").length,
    notConnected: connectors.filter((item) => item.publicState === "not_connected").length,
  };
  const configuredApprovals = input.approvals.providers.filter((item) => item.configured);
  const missingProviders = configuredApprovals
    .filter((item) => item.missingScopes.length > 0)
    .map((item) => item.provider);
  return {
    status: "ready",
    summary,
    permissionSetup: {
      visible: input.approvals.enforcement.mode === "report_only",
      readyCount: configuredApprovals.length - missingProviders.length,
      totalConfigured: configuredApprovals.length,
      missingProviders,
      activationReady: input.approvals.activationReady,
    },
    approvals: input.approvals,
    connectors,
  };
}

export async function getStudioCollectionsView(
  actorEmail: string,
  existingOverview?: StudioOverview,
  setupReady?: Partial<Record<PublicConnectorProvider, boolean>>,
): Promise<StudioCollectionsView> {
  const [overview, approvals, spotify, discogs, strava, gateEntries] =
    await Promise.all([
      existingOverview ?? getStudioOverview(actorEmail),
      getConnectorPublicationApprovalOverview(),
      getSpotifyPresentationConfig(),
      getDiscogsPresentationConfig(),
      getStravaPublicConfig(undefined, { bypassPublicationApproval: true }),
      Promise.all(
        PUBLIC_CONNECTOR_PROVIDERS.map(
          async (provider) => [provider, await connectorPublicationGate(provider)] as const,
        ),
      ),
    ]);
  if (overview.status !== "ready" || approvals.status !== "ready") {
    return {
      status: "setup_required",
      summary: { live: 0, needsAction: 0, private: 0, notConnected: 6 },
      permissionSetup: {
        visible: false,
        readyCount: 0,
        totalConfigured: 0,
        missingProviders: [],
        activationReady: false,
      },
      approvals: null,
      connectors: [],
    };
  }
  const gates = Object.fromEntries(gateEntries) as Record<
    PublicConnectorProvider,
    GateResult
  >;
  return composeStudioConnectorViews({
    health: overview.connectors,
    approvals,
    gates,
    spotifyPublished:
      spotify.status === "ready"
        ? spotify.config.publishTopTracks
        : "setup_required",
    discogsPublished:
      discogs.status === "ready"
        ? discogs.config.publishCollection
        : "setup_required",
    strava:
      strava.status === "ready"
        ? {
            configured: true,
            embedStatus: strava.config.embedStatus,
            checkedAt: strava.config.embed?.checkedAt ?? null,
            updatedAt: strava.config.updatedAt,
          }
        : { configured: false },
    setupReady,
  });
}
