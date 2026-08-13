import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

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
