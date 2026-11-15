import assert from "node:assert/strict";
import test from "node:test";

import { assertLighthouseAssetLoaded, selectMedianLighthouseResult } from "../scripts/lib/lighthouse-statistics.mjs";

function sample(score, id) {
  return {
    id,
    lhr: { categories: { performance: { score } } },
  };
}

test("Lighthouse release budgets select the median performance run", () => {
  const selected = selectMedianLighthouseResult([
    sample(0.89, "low"),
    sample(0.93, "high"),
    sample(0.91, "median"),
  ]);
  assert.equal(selected.id, "median");
});

test("Lighthouse median selection is stable for tied scores", () => {
  const selected = selectMedianLighthouseResult([
    sample(0.9, "first"),
    sample(0.9, "second"),
    sample(0.9, "third"),
  ]);
  assert.equal(selected.id, "second");
});

test("Lighthouse median selection rejects invalid sample sets", () => {
  assert.throws(() => selectMedianLighthouseResult([]), /odd, non-empty/u);
  assert.throws(
    () => selectMedianLighthouseResult([sample(0.9, "one"), sample(0.91, "two")]),
    /odd, non-empty/u,
  );
  assert.throws(
    () => selectMedianLighthouseResult([sample(0.9, "one"), sample(null, "bad"), sample(0.91, "two")]),
    /no finite performance score/u,
  );
});

test("Room performance evidence requires a successful exact first-party 3D asset request", () => {
  const url = "http://127.0.0.1:4174/assets/play/diorama.test.glb";
  const result = (items) => ({ lhr: { audits: { "network-requests": { details: { items } } } } });
  assert.doesNotThrow(() => assertLighthouseAssetLoaded(result([{ url, statusCode: 200 }]), url));
  for (const items of [[], [{ url, statusCode: 404 }], [{ url: url.replace("127.0.0.1:4174", "example.com"), statusCode: 200 }]]) {
    assert.throws(() => assertLighthouseAssetLoaded(result(items), url), /static fallback is not runtime performance evidence/);
  }
  assert.throws(() => assertLighthouseAssetLoaded({}, url), /did not load/);
});
