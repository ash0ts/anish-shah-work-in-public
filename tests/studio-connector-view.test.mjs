import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const { composeStudioConnectorViews } = await import(
  "../lib/server/connectors/studio-connector-view.ts"
);

const providers = [
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
  "strava",
];
const now = Date.parse("2026-08-13T12:00:00.000Z");

function health(provider, overrides = {}) {
  return {
    provider,
    configured: false,
    canReuseOAuthClient: false,
    status: "setup_required",
    lastSyncedAt: null,
    freshUntil: null,
    credentialExpiresAt: null,
    authorizedAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    retryNotBefore: null,
    itemCount: null,
    ...overrides,
  };
}

function approval(provider, overrides = {}) {
  return {
    provider,
    scopes: ["public_display", "retain_last_known_good"],
    approvedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    enabled: true,
    active: true,
    referenceStored: true,
    source: "unified",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides = {}) {
  const approvalProviders = providers.map((provider) => ({
    provider,
    configured: false,
    approval: null,
    missingScopes: ["public_display", "retain_last_known_good"],
  }));
  return {
    now,
    health: providers
      .filter((provider) => provider !== "strava")
      .map((provider) => health(provider)),
    approvals: {
      status: "ready",
      enforcement: {
        mode: "report_only",
        activatedAt: null,
        updatedAt: null,
      },
      providers: approvalProviders,
      activationReady: true,
      approvalStateDigest: "test-digest",
    },
    gates: Object.fromEntries(
      providers.map((provider) => [
        provider,
        {
          status: "allowed",
          mode: "report_only",
          retainLastKnownGood: true,
        },
      ]),
    ),
    spotifyPublished: false,
    discogsPublished: false,
    strava: { configured: false },
    ...overrides,
  };
}

function withProvider(base, provider, values) {
  return {
    ...base,
    health:
      provider === "strava"
        ? base.health
        : base.health.map((entry) =>
            entry.provider === provider
              ? health(provider, { ...entry, ...(values.health ?? {}) })
              : entry,
          ),
    approvals: {
      ...base.approvals,
      providers: base.approvals.providers.map((entry) =>
        entry.provider === provider
          ? {
              ...entry,
              configured: values.configured ?? entry.configured,
              approval: values.approval ?? entry.approval,
              missingScopes:
                values.missingScopes ?? entry.missingScopes,
            }
          : entry,
      ),
    },
    gates: values.gate
      ? { ...base.gates, [provider]: values.gate }
      : base.gates,
    ...(provider === "strava" && values.strava
      ? { strava: values.strava }
      : {}),
  };
}

function connector(view, provider) {
  return view.connectors.find((entry) => entry.provider === provider);
}

test("lifecycle precedence resolves setup, connection, authorization, and reauthorization first", () => {
  let state = input();
  assert.equal(
    connector(composeStudioConnectorViews(state), "hardcover").primaryAction,
    "connect",
  );

  state = withProvider(state, "myanimelist", {
    health: { status: "authorization_required" },
  });
  assert.equal(
    connector(composeStudioConnectorViews(state), "myanimelist")
      .primaryAction,
    "continue_authorization",
  );

  state = withProvider(state, "steam", {
    configured: true,
    health: { configured: true, status: "setup_required" },
  });
  assert.deepEqual(
    {
      action: connector(composeStudioConnectorViews(state), "steam")
        .primaryAction,
      publicState: connector(composeStudioConnectorViews(state), "steam")
        .publicState,
    },
    { action: "resolve_environment", publicState: "needs_action" },
  );

  state = withProvider(state, "spotify", {
    configured: true,
    health: {
      configured: true,
      status: "reauthorization_required",
      canReuseOAuthClient: true,
    },
    gate: {
      status: "withheld",
      mode: "report_only",
      retainLastKnownGood: false,
    },
  });
  assert.equal(
    connector(composeStudioConnectorViews(state), "spotify").primaryAction,
    "reauthorize",
  );
});

test("environment setup takes precedence over connection and synchronization", () => {
  const state = input({
    setupReady: { myanimelist: false },
  });
  assert.deepEqual(
    {
      action: connector(composeStudioConnectorViews(state), "myanimelist")
        .primaryAction,
      publicState: connector(composeStudioConnectorViews(state), "myanimelist")
        .publicState,
    },
    { action: "resolve_environment", publicState: "needs_action" },
  );
});

test("report-only distinguishes live grandfathered data from a newly withheld provider", () => {
  const base = withProvider(input({ spotifyPublished: true }), "spotify", {
    configured: true,
    health: {
      configured: true,
      status: "healthy",
      itemCount: 12,
      lastSyncedAt: "2026-08-12T00:00:00.000Z",
      freshUntil: "2026-08-14T00:00:00.000Z",
    },
  });
  const grandfathered = composeStudioConnectorViews(base);
  assert.deepEqual(
    {
      state: connector(grandfathered, "spotify").publicState,
      action: connector(grandfathered, "spotify").primaryAction,
      gate: connector(grandfathered, "spotify").permission.gate,
      live: grandfathered.summary.live,
      needsAction: grandfathered.summary.needsAction,
    },
    {
      state: "live",
      action: "record_public_permission",
      gate: "allowed_grandfathered",
      live: 1,
      needsAction: 6,
    },
  );

  const pending = composeStudioConnectorViews(
    withProvider(base, "spotify", {
      configured: true,
      gate: {
        status: "withheld",
        mode: "report_only",
        retainLastKnownGood: false,
      },
    }),
  );
  assert.deepEqual(
    {
      state: connector(pending, "spotify").publicState,
      action: connector(pending, "spotify").primaryAction,
      gate: connector(pending, "spotify").permission.gate,
    },
    {
      state: "private",
      action: "record_public_permission",
      gate: "withheld",
    },
  );
});

test("permission state separates restorable private records from expired records", () => {
  const disabled = composeStudioConnectorViews(
    withProvider(input(), "hardcover", {
      configured: true,
      health: { configured: true, status: "healthy", itemCount: 30 },
      approval: approval("hardcover", { enabled: false, active: false }),
      missingScopes: ["public_display", "retain_last_known_good"],
      gate: {
        status: "withheld",
        mode: "required",
        retainLastKnownGood: false,
      },
    }),
  );
  assert.equal(connector(disabled, "hardcover").permission.status, "disabled");
  assert.equal(
    connector(disabled, "hardcover").primaryAction,
    "record_public_permission",
  );

  const expired = composeStudioConnectorViews(
    withProvider(input(), "hardcover", {
      configured: true,
      health: { configured: true, status: "healthy", itemCount: 30 },
      approval: approval("hardcover", {
        active: false,
        expiresAt: "2026-08-12T23:59:59.000Z",
      }),
      missingScopes: ["public_display", "retain_last_known_good"],
      gate: {
        status: "withheld",
        mode: "required",
        retainLastKnownGood: false,
      },
    }),
  );
  assert.equal(connector(expired, "hardcover").permission.status, "expired");
});

test("Spotify and Discogs expose publish only after approval and a saved snapshot", () => {
  let state = input({ spotifyPublished: false, discogsPublished: false });
  for (const provider of ["spotify", "discogs"]) {
    state = withProvider(state, provider, {
      configured: true,
      approval: approval(provider),
      missingScopes: [],
      health: {
        configured: true,
        status: "healthy",
        itemCount: provider === "spotify" ? 36 : 120,
        lastSyncedAt: "2026-08-12T00:00:00.000Z",
        freshUntil: "2026-08-14T00:00:00.000Z",
      },
    });
  }
  const unpublished = composeStudioConnectorViews(state);
  assert.equal(connector(unpublished, "spotify").primaryAction, "publish");
  assert.equal(connector(unpublished, "discogs").primaryAction, "publish");

  const published = composeStudioConnectorViews({
    ...state,
    spotifyPublished: true,
    discogsPublished: true,
  });
  assert.equal(connector(published, "spotify").primaryAction, "refresh");
  assert.equal(connector(published, "discogs").primaryAction, "refresh");

  const unpublishedAfterFailure = composeStudioConnectorViews(
    withProvider(input({ spotifyPublished: false }), "spotify", {
      configured: true,
      approval: approval("spotify"),
      missingScopes: [],
      health: {
        configured: true,
        status: "error",
        itemCount: 36,
        lastSyncedAt: "2026-08-12T00:00:00.000Z",
        lastErrorCode: "provider_unavailable",
      },
    }),
  );
  assert.equal(
    connector(unpublishedAfterFailure, "spotify").primaryAction,
    "publish",
  );
});

test("Discogs cooldown and failed refresh states choose wait then retry deterministically", () => {
  const approvedDiscogs = {
    configured: true,
    approval: approval("discogs"),
    missingScopes: [],
  };
  const waiting = composeStudioConnectorViews(
    withProvider(input({ discogsPublished: true }), "discogs", {
      ...approvedDiscogs,
      health: {
        configured: true,
        status: "error",
        itemCount: 120,
        lastSyncedAt: "2026-08-12T00:00:00.000Z",
        freshUntil: "2026-08-14T00:00:00.000Z",
        lastErrorCode: "rate_limited",
        retryNotBefore: "2026-08-13T12:30:00.000Z",
      },
    }),
  );
  assert.equal(connector(waiting, "discogs").primaryAction, "wait_retry");
  assert.equal(connector(waiting, "discogs").publicState, "live");

  const retrying = composeStudioConnectorViews({
    ...withProvider(input({ discogsPublished: true }), "discogs", {
      ...approvedDiscogs,
      health: {
        configured: true,
        status: "error",
        itemCount: 120,
        lastSyncedAt: "2026-08-12T00:00:00.000Z",
        freshUntil: "2026-08-14T00:00:00.000Z",
        lastErrorCode: "provider_unavailable",
        retryNotBefore: "2026-08-13T11:30:00.000Z",
      },
    }),
  });
  assert.equal(connector(retrying, "discogs").primaryAction, "retry");

  const firstSyncRateLimited = composeStudioConnectorViews(
    withProvider(input({ discogsPublished: false }), "discogs", {
      ...approvedDiscogs,
      health: {
        configured: true,
        status: "error",
        itemCount: null,
        lastSyncedAt: null,
        lastErrorCode: "rate_limited",
        retryNotBefore: "2026-08-13T12:30:00.000Z",
      },
    }),
  );
  assert.equal(
    connector(firstSyncRateLimited, "discogs").primaryAction,
    "wait_retry",
  );
});

test("Strava uses saved configuration and permission without inventing a snapshot", () => {
  const state = withProvider(input(), "strava", {
    configured: true,
    approval: approval("strava"),
    missingScopes: [],
    strava: {
      configured: true,
      embedStatus: "available",
      checkedAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T09:00:00.000Z",
    },
  });
  const view = connector(composeStudioConnectorViews(state), "strava");
  assert.deepEqual(
    {
      publicState: view.publicState,
      primaryAction: view.primaryAction,
      snapshot: view.snapshot,
      strava: view.strava,
    },
    {
      publicState: "live",
      primaryAction: "none",
      snapshot: {
        status: "none",
        itemCount: null,
        lastSyncedAt: "2026-08-13T09:00:00.000Z",
        stale: false,
        lastErrorCode: null,
        retryNotBefore: null,
      },
      strava: {
        embedStatus: "available",
        checkedAt: "2026-08-13T10:00:00.000Z",
        updatedAt: "2026-08-13T09:00:00.000Z",
      },
    },
  );
});
