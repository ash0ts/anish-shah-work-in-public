import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const {
  approvalDateAtStartOfDayUtc,
  approvalExpiryAtEndOfDayUtc,
  connectorApprovalReferenceField,
} = await import(
  "../app/studio/connectors/publication-approval-form.ts"
);

test("connector approval date fields use explicit UTC day boundaries", () => {
  assert.equal(
    approvalDateAtStartOfDayUtc("2026-08-13"),
    "2026-08-13T00:00:00.000Z",
  );
  assert.equal(
    approvalExpiryAtEndOfDayUtc("2026-08-13"),
    "2026-08-13T23:59:59.000Z",
  );
  assert.equal(approvalExpiryAtEndOfDayUtc(""), null);
  assert.equal(approvalExpiryAtEndOfDayUtc("2026-02-29"), null);
  assert.equal(approvalExpiryAtEndOfDayUtc("08/13/2026"), null);
});

test("only unified encrypted references may be left blank", () => {
  assert.deepEqual(connectorApprovalReferenceField("unified"), {
    required: false,
    placeholder: "Stored encrypted — leave blank to keep",
    legacyHelp: null,
  });
  assert.deepEqual(connectorApprovalReferenceField("legacy_discogs"), {
    required: true,
    placeholder: "New reference required",
    legacyHelp:
      "Enter the permission reference again. The legacy reference cannot be reused.",
  });
  assert.deepEqual(connectorApprovalReferenceField(null), {
    required: true,
    placeholder: "Private reference",
    legacyHelp: null,
  });
});

test("Studio presents provider-local permission and one-time setup instead of a global grid", async () => {
  const [page, collections, banner, permission, actionLabels, generic, strava] =
    await Promise.all([
      source("app/studio/page.tsx"),
      source("app/studio/StudioCollections.tsx"),
      source("app/studio/PermissionSetupBanner.tsx"),
      source("app/studio/connectors/ConnectorPermissionControl.tsx"),
      source("app/studio/connectors/action-label.ts"),
      source("app/studio/connectors/ApiConnectorPanel.tsx"),
      source("app/studio/connectors/StravaConnectorPanel.tsx"),
    ]);

  assert.match(page, /<StudioCollections/);
  assert.doesNotMatch(page, /<ConnectorPublicationApprovals/);
  assert.match(collections, /live collections/);
  assert.match(collections, /Collections needing attention/);
  assert.match(banner, /Finish permission setup/);
  assert.match(banner, /Future providers stay[\s\S]*private/);
  assert.match(permission, /Allow public display and saved snapshots/);
  assert.match(permission, /Private reference/);
  assert.match(permission, /Permission confirmed/);
  assert.match(permission, /Expires · optional/);
  assert.match(permission, /Make private/);
  assert.match(permission, /Restore public access/);
  assert.match(permission, /Renew permission/);
  assert.match(permission, /expectedConfigurationRevision/);
  assert.match(permission, /stale_configuration/);
  assert.match(generic, /configurationRevision=\{view\.configurationRevision\}/);
  assert.match(strava, /configurationRevision=\{view\.configurationRevision\}/);
  assert.match(actionLabels, /view\.permission\.status === "disabled"/);
  assert.match(actionLabels, /view\.permission\.status === "expired"/);
  assert.match(banner, /await onUpdated\(uncertain\)/);
  assert.doesNotMatch(permission, /type="checkbox"/);
  assert.match(generic, /Advanced \/ recovery/);
  assert.match(strava, /Advanced \/ recovery/);
  assert.match(strava, /Verify now/);
});

test("OAuth callbacks focus their collection, announce the outcome, and clean callback parameters", async () => {
  const [page, collections, generic] = await Promise.all([
    source("app/studio/page.tsx"),
    source("app/studio/StudioCollections.tsx"),
    source("app/studio/connectors/ApiConnectorPanel.tsx"),
  ]);

  assert.match(page, /initialExpandedProvider/);
  assert.match(collections, /scrollIntoView/);
  assert.match(collections, /querySelector<HTMLElement>\("summary"\)\?\.focus\(\)/);
  assert.match(generic, /connection saved\. Allow public use next\./);
  assert.match(generic, /searchParams\.delete\("connector"\)/);
  assert.match(generic, /searchParams\.delete\("result"\)/);
  assert.match(generic, /window\.history\.state/);
  assert.match(generic, /cleaned\.hash/);
  assert.match(generic, /window\.history\.replaceState/);
  assert.doesNotMatch(generic, /window\.location\.reload/);
});

test("the composed workspace preserves success announcements and advances focus", async () => {
  const [collections, generic, permission, spotify, discogs] =
    await Promise.all([
      source("app/studio/StudioCollections.tsx"),
      source("app/studio/connectors/ApiConnectorPanel.tsx"),
      source("app/studio/connectors/ConnectorPermissionControl.tsx"),
      source("app/studio/connectors/SpotifyConnectorPanel.tsx"),
      source("app/studio/connectors/DiscogsConnectorPanel.tsx"),
    ]);

  assert.match(collections, /workspaceMessage/);
  assert.match(collections, /role="status" aria-live="polite"/);
  assert.match(collections, /data-studio-primary-action/);
  assert.match(generic, /focusAfterAction\.current = view\.primaryAction/);
  assert.match(generic, /data-studio-primary-action/);
  assert.match(permission, /await onUpdated\(success\)/);
  assert.match(spotify, /await onUpdated\(success\)/);
  assert.match(discogs, /await onUpdated\(success\)/);
});

test("disabled Simulation approvals stay out of routine Studio", async () => {
  const page = await source("app/studio/page.tsx");
  assert.match(
    page,
    /runtimeValue\("SIMULATION_EXPERIENCE_MODE"\) !== "disabled"/,
  );
});

test("publication approval scopes are fixed by the server contract", async () => {
  const handler = await source(
    "lib/server/http/connector-publication-approvals.ts",
  );
  assert.match(handler, /hasFixedApprovalScopes/);
  assert.match(
    handler,
    /value\.length === CONNECTOR_PUBLICATION_APPROVAL_SCOPES\.length/,
  );
  assert.match(
    handler,
    /scopes: \[\.\.\.CONNECTOR_PUBLICATION_APPROVAL_SCOPES\]/,
  );
  assert.match(handler, /typeof body\.expectedConfigurationRevision !== "string"/);
  assert.match(handler, /result\.reason === "stale_configuration"/);
  assert.match(handler, /\? 409/);
  assert.doesNotMatch(handler, /scopes,\s*approvedAt/);
});
