import assert from "node:assert/strict";
import test from "node:test";
import { shouldOpenRoom, roomDirectoryHref } from "../components/play/room-platform/room-entry-policy.ts";

test("Play navigation opens once, after eligibility", () => {
  const input = { directory: false, eligible: true, entered: false, failed: false, attempted: false };
  assert.equal(shouldOpenRoom(input), true);
  for (const change of [{ directory: true }, { eligible: false }, { entered: true }, { failed: true }, { attempted: true }]) {
    assert.equal(shouldOpenRoom({ ...input, ...change }), false);
  }
});
test("leaving selects the directory without losing preview state", () => {
  assert.equal(roomDirectoryHref(""), "/play?view=directory");
  assert.equal(roomDirectoryHref("?fixture=stale"), "/play?fixture=stale&view=directory");
});
