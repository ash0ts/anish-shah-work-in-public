import assert from "node:assert/strict";
import test from "node:test";

import { waitForPreviewReadiness } from "../scripts/preview-readiness.mjs";

const readyHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

test("preview readiness succeeds only after the complete safe response contract", async () => {
  let time = 1_000;
  const responses = [
    new Response(null, { status: 503 }),
    new Response(null, { status: 200, headers: { "x-robots-tag": "noindex" } }),
    new Response(null, { status: 200, headers: readyHeaders }),
  ];
  const seen = [];
  const result = await waitForPreviewReadiness({
    origin: "https://pr-26.anish-shah-is.online",
    accessClientId: "synthetic-client-id",
    accessClientSecret: "test-client-secret",
    timeoutMs: 10_000,
    attemptTimeoutMs: 1_000,
    now: () => time,
    wait: async (duration) => {
      time += duration;
    },
    fetcher: async (url, init) => {
      seen.push({ url: url.href, init });
      return responses.shift();
    },
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.elapsedMs, 6_000);
  assert.equal(seen[0].url, "https://pr-26.anish-shah-is.online/play");
  assert.equal(seen[0].init.redirect, "manual");
  assert.equal(
    seen[0].init.headers["CF-Access-Client-Id"],
    "synthetic-client-id",
  );
});

test("preview readiness uses an absolute deadline", async () => {
  let time = 0;
  let attempts = 0;
  await assert.rejects(
    waitForPreviewReadiness({
      origin: "https://pr-26.anish-shah-is.online",
      accessClientId: "synthetic-client-id",
      accessClientSecret: "test-client-secret",
      timeoutMs: 5_000,
      attemptTimeoutMs: 4_000,
      now: () => time,
      wait: async (duration) => {
        time += duration;
      },
      fetcher: async () => {
        attempts += 1;
        time += 4_000;
        throw new Error("not ready");
      },
    }),
    /within 5000ms/,
  );
  assert.equal(attempts, 1);
  assert.equal(time, 5_000);
});

test("preview readiness rejects non-preview origins and missing credentials", async () => {
  await assert.rejects(
    waitForPreviewReadiness({
      origin: "https://anish-shah-is.online",
      accessClientId: "id",
      accessClientSecret: "secret",
    }),
    /exact HTTPS PR-preview origin/,
  );
  await assert.rejects(
    waitForPreviewReadiness({
      origin: "https://pr-26.anish-shah-is.online",
      accessClientId: "",
      accessClientSecret: "",
    }),
    /credentials are required/,
  );
});
