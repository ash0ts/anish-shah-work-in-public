import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [oauth, repository, cryptoModule] = await Promise.all([
  import("../lib/server/connectors/discogs-oauth.ts"),
  import("../lib/server/connectors/discogs-oauth-repository.ts"),
  import("../lib/server/credential-crypto.ts"),
]);

const {
  buildDiscogsAuthorizationHeader,
  clearDiscogsOAuthBrowserCookie,
  createDiscogsOAuthBrowserNonce,
  discogsOAuthBrowserCookie,
  discogsOAuthBrowserNonceFromRequest,
  DISCOGS_ACCESS_TOKEN_ENDPOINT,
  DISCOGS_REQUEST_TOKEN_ENDPOINT,
  requestDiscogsTemporaryCredential,
  resolveDiscogsCallbackUrl,
} = oauth;
const {
  completeDiscogsOAuth,
  stageDiscogsOAuthCallback,
  startDiscogsOAuth,
} = repository;
const { decryptCredential, encryptCredential } = cryptoModule;

const encryptionKey = Buffer.alloc(32, 29).toString("base64");
const ownerEmail = "owner@example.com";
const localEnvironment = {
  CONNECTOR_ENCRYPTION_KEY: encryptionKey,
  NODE_ENV: "development",
  SITE_URL: "http://localhost:3000",
};
const startUrl =
  "http://localhost:3000/api/studio/connectors/discogs/oauth/start";
const callbackUrl =
  "http://127.0.0.1:3000/api/connectors/discogs/oauth/callback";
const localResumeUrl =
  "http://localhost:3000/api/connectors/discogs/oauth/callback";

function form(
  body,
  status = 200,
  contentType = "application/x-www-form-urlencoded",
) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function oauthHeaderParameters(header) {
  assert.match(header, /^OAuth /);
  return new Map(
    header
      .slice("OAuth ".length)
      .split(", ")
      .map((entry) => {
        const match = /^([^=]+)="([^"\r\n]*)"$/.exec(entry);
        assert(match, `Invalid OAuth header entry: ${entry}`);
        return [decodeURIComponent(match[1]), decodeURIComponent(match[2])];
      }),
  );
}

async function withFetch(mock, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

async function withRuntime(database, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    ...localEnvironment,
    DB: database,
  };
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return this.database.first(this);
  }

  run() {
    return this.database.run(this);
  }
}

class DiscogsOAuthD1 {
  constructor() {
    this.transactions = new Map();
    this.credentials = new Map();
    this.snapshots = [];
    this.runs = [];
    this.audits = [];
    this.presentationSetting = null;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async first(statement) {
    if (statement.sql.includes("FROM connector_oauth_transactions")) {
      return this.transactions.get(statement.values[0]) ?? null;
    }
    if (statement.sql.includes("FROM connector_credentials")) {
      return this.credentials.get("discogs") ?? null;
    }
    return null;
  }

  async run(statement) {
    return {
      results: [],
      success: true,
      meta: { changes: this.apply(statement) },
    };
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await this.run(statement));
    return results;
  }

  apply(statement) {
    const { sql, values } = statement;

    if (sql.startsWith("INSERT INTO connector_oauth_transactions")) {
      const [
        stateHash,
        ciphertext,
        iv,
        keyVersion,
        storedOwnerEmail,
        redirectUri,
        expiresAt,
        createdAt,
      ] = values;
      this.transactions.set(stateHash, {
        stateHash,
        ciphertext,
        iv,
        keyVersion,
        ownerEmail: storedOwnerEmail,
        redirectUri,
        expiresAt,
        consumedAt: null,
        createdAt,
      });
      return 1;
    }

    if (
      sql.startsWith("UPDATE connector_oauth_transactions") &&
      sql.includes("SET state_hash =")
    ) {
      const [replacementHash, ciphertext, iv, keyVersion, originalHash, now] =
        values;
      const transaction = this.transactions.get(originalHash);
      if (!transaction || transaction.consumedAt || transaction.expiresAt <= now) {
        return 0;
      }
      this.transactions.delete(originalHash);
      this.transactions.set(replacementHash, {
        ...transaction,
        stateHash: replacementHash,
        ciphertext,
        iv,
        keyVersion,
      });
      return 1;
    }

    if (
      sql.startsWith("UPDATE connector_oauth_transactions") &&
      sql.includes("SET consumed_at =")
    ) {
      const [consumedAt, stateHash, now] = values;
      const transaction = this.transactions.get(stateHash);
      if (!transaction || transaction.consumedAt || transaction.expiresAt <= now) {
        return 0;
      }
      transaction.consumedAt = consumedAt;
      return 1;
    }

    if (sql.startsWith("DELETE FROM connector_oauth_transactions")) {
      if (sql.includes("state_hash = ?")) {
        return this.transactions.delete(values[0]) ? 1 : 0;
      }
      let deleted = 0;
      if (sql.includes("expires_at <= ?")) {
        for (const [key, transaction] of this.transactions) {
          if (transaction.expiresAt <= values[0]) {
            this.transactions.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      }
      if (sql.includes("owner_email = ?")) {
        for (const [key, transaction] of this.transactions) {
          if (transaction.ownerEmail === values[0]) {
            this.transactions.delete(key);
            deleted += 1;
          }
        }
      }
      return deleted;
    }

    if (sql.startsWith("INSERT INTO connector_credentials")) {
      const [
        ciphertext,
        iv,
        keyVersion,
        createdAt,
        updatedAt,
        stateHash,
        storedOwnerEmail,
        now,
      ] = values;
      const transaction = this.transactions.get(stateHash);
      if (
        !transaction ||
        transaction.ownerEmail !== storedOwnerEmail ||
        !transaction.consumedAt ||
        transaction.expiresAt <= now
      ) {
        return 0;
      }
      const previous = this.credentials.get("discogs");
      this.credentials.set("discogs", {
        ciphertext,
        iv,
        keyVersion,
        createdAt: previous?.createdAt ?? createdAt,
        updatedAt,
        generation: previous ? previous.generation + 1 : 1,
      });
      return 1;
    }

    if (sql.startsWith("DELETE FROM connector_snapshots")) {
      const previous = this.snapshots.length;
      this.snapshots = [];
      return previous;
    }
    if (sql.startsWith("UPDATE editorial_settings")) {
      if (!this.presentationSetting) return 0;
      this.presentationSetting = {
        ...this.presentationSetting,
        credentialGeneration: this.credentials.get("discogs")?.generation,
      };
      return 1;
    }
    if (sql.startsWith("DELETE FROM editorial_settings")) {
      if (
        sql.includes("NOT EXISTS") &&
        this.snapshots.length > 0
      ) {
        return 0;
      }
      const changed = this.presentationSetting === null ? 0 : 1;
      this.presentationSetting = null;
      return changed;
    }
    if (sql.startsWith("INSERT INTO editorial_settings")) {
      if (
        sql.includes("NOT EXISTS") &&
        this.snapshots.length > 0
      ) {
        return 0;
      }
      return 1;
    }
    if (sql.startsWith("DELETE FROM sync_runs")) {
      const previous = this.runs.length;
      this.runs = [];
      return previous;
    }
    if (sql.startsWith("DELETE FROM audit_log")) {
      const previous = this.audits.length;
      this.audits = [];
      return previous;
    }
    if (sql.startsWith("INSERT INTO audit_log")) {
      if (!this.credentials.has("discogs")) return 0;
      this.audits.push({ sql, values: structuredClone(values) });
      return 1;
    }
    return 0;
  }
}

function requestTokenFetch({
  accessStatus = 200,
  requestStatus = 200,
  responseContentType = "application/x-www-form-urlencoded",
} = {}) {
  return async (url, init) => {
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "manual");
    assert.equal(init.signal instanceof AbortSignal, true);
    const parameters = oauthHeaderParameters(init.headers.Authorization);
    assert.equal(parameters.get("oauth_signature_method"), "PLAINTEXT");
    assert.equal(parameters.get("oauth_consumer_key"), "discogs-consumer-key-one");
    assert.match(parameters.get("oauth_nonce"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(parameters.get("oauth_timestamp"), /^\d{10}$/);
    for (const forbidden of [
      "consumer-secret-one",
      "request-token-one",
      "request-secret-one",
      "verifier-one",
    ]) {
      assert.equal(String(url).includes(forbidden), false);
      assert.equal(String(init.body ?? "").includes(forbidden), false);
    }
    if (url === DISCOGS_REQUEST_TOKEN_ENDPOINT) {
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(
        init.headers["Content-Type"],
        "application/x-www-form-urlencoded",
      );
      assert.equal(parameters.has("oauth_token"), false);
      assert.equal(parameters.has("oauth_verifier"), false);
      assert.equal(parameters.get("oauth_callback"), callbackUrl);
      assert.equal(
        parameters.get("oauth_signature"),
        "discogs-consumer-secret-one&",
      );
      if (requestStatus !== 200) return form("", requestStatus);
      return form(
        "oauth_token=discogs-request-token-one&" +
          "oauth_token_secret=discogs-request-secret-one&" +
          "oauth_callback_confirmed=true",
        200,
        responseContentType,
      );
    }
    assert.equal(url, DISCOGS_ACCESS_TOKEN_ENDPOINT);
    assert.equal(init.method, "POST");
    assert.equal(init.body, "");
    assert.equal(
      init.headers["Content-Type"],
      "application/x-www-form-urlencoded",
    );
    assert.equal(parameters.get("oauth_token"), "discogs-request-token-one");
    assert.match(parameters.get("oauth_verifier"), /^discogs-verifier-/);
    assert.equal(
      parameters.get("oauth_signature"),
      "discogs-consumer-secret-one&discogs-request-secret-one",
    );
    if (accessStatus !== 200) return form("", accessStatus);
    return form(
      "oauth_token=discogs-access-token-one&" +
        "oauth_token_secret=discogs-access-secret-one",
      200,
      responseContentType,
    );
  };
}

async function begin(database, browserNonce, fetchOptions) {
  return withRuntime(database, () =>
    withFetch(requestTokenFetch(fetchOptions), () =>
      startDiscogsOAuth({
        consumerKey: "discogs-consumer-key-one",
        consumerSecret: "discogs-consumer-secret-one",
        actorEmail: ownerEmail,
        browserNonce,
        requestUrl: startUrl,
      }),
    ),
  );
}

test("Discogs signing matches the corrected RFC 5849 HMAC-SHA1 vector", async () => {
  const rfcAccessToken = ["kkk9d7", "dh3k39sjv7"].join("");
  const rfcAccessTokenSecret = ["dh893h", "dasih9"].join("");
  const header = await buildDiscogsAuthorizationHeader({
    method: "POST",
    url: "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b",
    credential: {
      kind: "oauth1",
      consumerKey: "9djdj82h48djs9d2",
      consumerSecret: "j49sk3j29djd",
      accessToken: rfcAccessToken,
      accessTokenSecret: rfcAccessTokenSecret,
    },
    bodyParameters: new URLSearchParams("c2&a3=2+q"),
    nonce: "7d8f3e4a",
    timestamp: 137131201,
    includeVersion: false,
  });
  const encodedSignature = /oauth_signature="([^"]+)"/.exec(header)?.[1];
  assert.equal(
    decodeURIComponent(encodedSignature ?? ""),
    "r6/TJjbCOr97/+UU0NsvSne7s5g=",
  );
  assert.equal(header.includes("j49sk3j29djd"), false);
  assert.equal(header.includes("dh893hdasih9"), false);
});

test("Discogs token signing percent-encodes reserved secret characters", async () => {
  const consumerSecret = ["discogs-reserved-secret", "/with+chars="].join("");
  const credential = await withFetch(async (url, init) => {
    assert.equal(url, DISCOGS_REQUEST_TOKEN_ENDPOINT);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(String(url).includes(consumerSecret), false);
    const parameters = oauthHeaderParameters(init.headers.Authorization);
    assert.equal(parameters.get("oauth_signature_method"), "PLAINTEXT");
    assert.equal(
      parameters.get("oauth_signature"),
      "discogs-reserved-secret%2Fwith%2Bchars%3D&",
    );
    return form(
      "oauth_token=discogs-request-token-one&" +
        "oauth_token_secret=discogs-request-secret-one&" +
        "oauth_callback_confirmed=true",
    );
  }, () =>
    requestDiscogsTemporaryCredential(
      {
        consumerKey: "discogs-consumer-key-one",
        consumerSecret,
      },
      callbackUrl,
    ),
  );
  assert.deepEqual(credential, {
    requestToken: "discogs-request-token-one",
    requestTokenSecret: "discogs-request-secret-one",
  });
});

test("Discogs callbacks are pinned to exact local, staging, and apex origins", () => {
  assert.equal(
    resolveDiscogsCallbackUrl(
      startUrl,
      "http://localhost:3000",
      "development",
    ),
    callbackUrl,
  );
  assert.equal(
    resolveDiscogsCallbackUrl(
      "https://anish-shah-is.online/studio",
      "https://anish-shah-is.online",
      "production",
    ),
    "https://anish-shah-is.online/api/connectors/discogs/oauth/callback",
  );
  assert.equal(
    resolveDiscogsCallbackUrl(
      "https://staging.anish-shah-is.online/studio",
      "https://staging.anish-shah-is.online",
      "production",
    ),
    "https://staging.anish-shah-is.online/api/connectors/discogs/oauth/callback",
  );
  assert.equal(
    resolveDiscogsCallbackUrl(
      "https://old.example/studio",
      "https://old.example",
      "production",
    ),
    null,
  );
  assert.equal(
    resolveDiscogsCallbackUrl(
      "http://127.0.0.1:3000/studio",
      "http://localhost:3000",
      "development",
    ),
    callbackUrl,
  );
  assert.equal(
    resolveDiscogsCallbackUrl(
      "http://localhost:3001/studio",
      "http://localhost:3000",
      "development",
    ),
    null,
  );
});

test("Discogs browser binding uses a short-lived HttpOnly same-site cookie", () => {
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const localCookie = discogsOAuthBrowserCookie(browserNonce, startUrl);
  assert.match(localCookie, /Path=\//);
  assert.match(localCookie, /Max-Age=600/);
  assert.match(localCookie, /HttpOnly/);
  assert.match(localCookie, /SameSite=Lax/);
  assert.doesNotMatch(localCookie, /; Secure/);

  const productionCookie = discogsOAuthBrowserCookie(
    browserNonce,
    "https://anish-shah-is.online/studio",
  );
  assert.match(productionCookie, /; Secure/);
  const request = new Request(callbackUrl, {
    headers: { cookie: productionCookie.split(";", 1)[0] },
  });
  assert.equal(discogsOAuthBrowserNonceFromRequest(request), browserNonce);
  assert.match(
    clearDiscogsOAuthBrowserCookie(
      "https://anish-shah-is.online/api/connectors/discogs/oauth/callback",
    ),
    /Max-Age=0[\s\S]*HttpOnly[\s\S]*Secure/,
  );
});

test("Discogs request-token state is hashed, encrypted, owner/callback/browser-bound, and ten-minute limited", async () => {
  const database = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(database, browserNonce);
  assert.equal(started.status, "authorization_required");
  assert.equal(started.callbackUrl, callbackUrl);
  assert.equal(
    started.authorizationUrl,
    "https://www.discogs.com/oauth/authorize?oauth_token=discogs-request-token-one",
  );
  assert.equal(started.authorizationUrl.includes("request-secret"), false);
  assert.equal(database.transactions.size, 1);

  const [transaction] = database.transactions.values();
  assert.equal(transaction.ownerEmail, ownerEmail);
  assert.equal(transaction.redirectUri, callbackUrl);
  assert.notEqual(transaction.stateHash, "discogs-request-token-one");
  assert(Date.parse(transaction.expiresAt) > Date.now());
  assert(Date.parse(transaction.expiresAt) - Date.now() <= 10 * 60 * 1000);
  const serialized = JSON.stringify(transaction);
  assert.equal(serialized.includes("consumer-secret-one"), false);
  assert.equal(serialized.includes("request-token-one"), false);
  assert.equal(serialized.includes("request-secret-one"), false);
  assert.equal(serialized.includes(browserNonce), false);

  const decrypted = await decryptCredential(
    transaction,
    encryptionKey,
    "discogs-oauth-transaction",
  );
  assert.equal(decrypted.consumerSecret, "discogs-consumer-secret-one");
  assert.equal(decrypted.requestToken, "discogs-request-token-one");
  assert.equal(decrypted.ownerEmail, ownerEmail);
  assert.equal(decrypted.callbackUrl, callbackUrl);
  assert.equal(decrypted.stateHash, transaction.stateHash);

  const wrongBrowser = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: "discogs-request-token-one",
      oauthVerifier: "discogs-verifier-one",
      browserNonce: createDiscogsOAuthBrowserNonce(),
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(wrongBrowser, { status: "invalid_state" });
});

test("Discogs token exchanges accept bounded form text and reject other media", async () => {
  const textDatabase = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(textDatabase, browserNonce, {
    responseContentType: "text/plain; charset=utf-8",
  });
  assert.equal(started.status, "authorization_required");
  const staged = await withRuntime(textDatabase, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(started.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-one",
      browserNonce,
      requestUrl: callbackUrl,
    }),
  );
  const completed = await withRuntime(textDatabase, () =>
    withFetch(
      requestTokenFetch({ responseContentType: "text/plain; charset=utf-8" }),
      () =>
        completeDiscogsOAuth({
          resumeState: staged.resumeState,
          actorEmail: ownerEmail,
          browserNonce,
          requestUrl: localResumeUrl,
        }),
    ),
  );
  assert.deepEqual(completed, { status: "connected" });

  const invalidDatabase = new DiscogsOAuthD1();
  const invalid = await withRuntime(invalidDatabase, () =>
    withFetch(
      async () =>
        form(
          JSON.stringify({ oauth_token: "not-a-form-response" }),
          200,
          "application/json",
        ),
      () =>
        startDiscogsOAuth({
          consumerKey: "discogs-consumer-key-one",
          consumerSecret: "discogs-consumer-secret-one",
          actorEmail: ownerEmail,
          browserNonce: createDiscogsOAuthBrowserNonce(),
          requestUrl: startUrl,
        }),
    ),
  );
  assert.deepEqual(invalid, { status: "token_exchange_failed" });
  assert.equal(invalidDatabase.transactions.size, 0);
});

test("Discogs request-token failures stay sanitized and persist no transaction", async () => {
  for (const [requestStatus, expected] of [
    [401, { status: "invalid", reason: "credential" }],
    [429, { status: "rate_limited" }],
    [503, { status: "provider_unavailable", reason: "upstream" }],
  ]) {
    const database = new DiscogsOAuthD1();
    const result = await begin(database, createDiscogsOAuthBrowserNonce(), {
      requestStatus,
    });
    assert.deepEqual(result, expected);
    assert.equal(database.transactions.size, 0);
    assert.equal(JSON.stringify(result).includes("discogs-consumer"), false);
  }

  const database = new DiscogsOAuthD1();
  const result = await withRuntime(database, () =>
    withFetch(
      async () => {
        throw new TypeError("synthetic provider transport failure");
      },
      () =>
        startDiscogsOAuth({
          consumerKey: "discogs-consumer-key-one",
          consumerSecret: "discogs-consumer-secret-one",
          actorEmail: ownerEmail,
          browserNonce: createDiscogsOAuthBrowserNonce(),
          requestUrl: startUrl,
        }),
    ),
  );
  assert.deepEqual(result, {
    status: "provider_unavailable",
    reason: "transport",
  });
  assert.equal(database.transactions.size, 0);

  const redirectDatabase = new DiscogsOAuthD1();
  const redirected = await withRuntime(redirectDatabase, () =>
    withFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid/not-followed" },
        }),
      () =>
        startDiscogsOAuth({
          consumerKey: "discogs-consumer-key-one",
          consumerSecret: "discogs-consumer-secret-one",
          actorEmail: ownerEmail,
          browserNonce: createDiscogsOAuthBrowserNonce(),
          requestUrl: startUrl,
        }),
    ),
  );
  assert.deepEqual(redirected, {
    status: "provider_unavailable",
    reason: "redirect",
  });
  assert.equal(redirectDatabase.transactions.size, 0);
});

test("Discogs retries one transient request-token failure with a fresh nonce", async () => {
  const database = new DiscogsOAuthD1();
  const nonces = [];
  let requests = 0;
  const result = await withRuntime(database, () =>
    withFetch(
      async (url, init) => {
        assert.equal(url, DISCOGS_REQUEST_TOKEN_ENDPOINT);
        const parameters = oauthHeaderParameters(init.headers.Authorization);
        nonces.push(parameters.get("oauth_nonce"));
        requests += 1;
        if (requests === 1) return form("", 503);
        return form(
          "oauth_token=discogs-request-token-one&" +
            "oauth_token_secret=discogs-request-secret-one&" +
            "oauth_callback_confirmed=true",
        );
      },
      () =>
        startDiscogsOAuth({
          consumerKey: "discogs-consumer-key-one",
          consumerSecret: "discogs-consumer-secret-one",
          actorEmail: ownerEmail,
          browserNonce: createDiscogsOAuthBrowserNonce(),
          requestUrl: startUrl,
        }),
    ),
  );

  assert.equal(result.status, "authorization_required");
  assert.equal(requests, 2);
  assert.equal(nonces.length, 2);
  assert.notEqual(nonces[0], nonces[1]);
  assert.equal(database.transactions.size, 1);
});

test("Discogs bounds a stalled request-token response body by the OAuth timeout", async () => {
  const database = new DiscogsOAuthD1();
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  let oauthTimerCleared = 0;

  globalThis.setTimeout = (callback, delay, ...arguments_) =>
    nativeSetTimeout(callback, delay === 25_000 ? 5 : delay, ...arguments_);
  globalThis.clearTimeout = (handle) => {
    oauthTimerCleared += 1;
    return nativeClearTimeout(handle);
  };

  try {
    const result = await withRuntime(database, () =>
      withFetch(
        async (_url, init) => {
          const body = new ReadableStream({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () =>
                  controller.error(
                    new DOMException("The request was aborted.", "AbortError"),
                  ),
                { once: true },
              );
            },
          });
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": "application/x-www-form-urlencoded",
            },
          });
        },
        () =>
          startDiscogsOAuth({
            consumerKey: "discogs-consumer-key-one",
            consumerSecret: "discogs-consumer-secret-one",
            actorEmail: ownerEmail,
            browserNonce: createDiscogsOAuthBrowserNonce(),
            requestUrl: startUrl,
          }),
      ),
    );
    assert.deepEqual(result, {
      status: "provider_unavailable",
      reason: "timeout",
    });
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }

  assert.equal(database.transactions.size, 0);
  assert.equal(oauthTimerCleared, 1);
});

test("Discogs token responses reject duplicates, missing media, and oversized bodies", async () => {
  const invalidResponses = [
    () => new Response(
      "oauth_token=first&oauth_token=second&" +
        "oauth_token_secret=secret&oauth_callback_confirmed=true",
      {
        status: 200,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
      },
    ),
    () => new Response(
      new TextEncoder().encode(
        "oauth_token=token&oauth_token_secret=secret&" +
          "oauth_callback_confirmed=true",
      ),
      { status: 200 },
    ),
    () => new Response("x".repeat(32 * 1024 + 1), {
      status: 200,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    }),
  ];

  for (const providerResponse of invalidResponses) {
    const database = new DiscogsOAuthD1();
    const result = await withRuntime(database, () =>
      withFetch(
        async () => providerResponse(),
        () =>
          startDiscogsOAuth({
            consumerKey: "discogs-consumer-key-one",
            consumerSecret: "discogs-consumer-secret-one",
            actorEmail: ownerEmail,
            browserNonce: createDiscogsOAuthBrowserNonce(),
            requestUrl: startUrl,
          }),
      ),
    );
    assert.deepEqual(result, { status: "token_exchange_failed" });
    assert.equal(database.transactions.size, 0);
  }
});

test("Discogs callback consumes before exchange, rejects wrong owner, and prevents replay", async () => {
  const database = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(database, browserNonce);
  const staged = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(started.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-one",
      requestUrl: callbackUrl,
    }),
  );
  assert.equal(staged.status, "ready");
  const [stagedTransaction] = database.transactions.values();
  assert.equal(
    JSON.stringify(stagedTransaction).includes("discogs-verifier-one"),
    false,
  );

  const wrongOwner = await withRuntime(database, () =>
    completeDiscogsOAuth({
      resumeState: staged.resumeState,
      actorEmail: "not-owner@example.com",
      browserNonce,
      requestUrl: localResumeUrl,
    }),
  );
  assert.deepEqual(wrongOwner, { status: "invalid_state" });

  let consumedBeforeExchange = false;
  database.presentationSetting = {
    publishCollection: true,
    reviewedAt: new Date().toISOString(),
  };
  const completed = await withRuntime(database, () =>
    withFetch(async (url, init) => {
      if (url === DISCOGS_ACCESS_TOKEN_ENDPOINT) {
        consumedBeforeExchange = [...database.transactions.values()].every(
          (entry) => Boolean(entry.consumedAt),
        );
      }
      return requestTokenFetch()(url, init);
    }, () =>
      completeDiscogsOAuth({
        resumeState: staged.resumeState,
        actorEmail: ownerEmail,
        browserNonce,
        requestUrl: localResumeUrl,
      }),
    ),
  );
  assert.deepEqual(completed, { status: "connected" });
  assert.equal(consumedBeforeExchange, true);
  assert.equal(database.transactions.size, 0);
  assert.equal(database.credentials.get("discogs").generation, 1);
  assert.equal(database.presentationSetting, null);

  const credential = await decryptCredential(
    database.credentials.get("discogs"),
    encryptionKey,
    "discogs",
  );
  assert.deepEqual(credential, {
    kind: "oauth1",
    consumerKey: "discogs-consumer-key-one",
    consumerSecret: "discogs-consumer-secret-one",
    accessToken: "discogs-access-token-one",
    accessTokenSecret: "discogs-access-secret-one",
  });
  const persisted = JSON.stringify({
    credential: database.credentials.get("discogs"),
    audits: database.audits,
  });
  for (const forbidden of [
    "consumer-secret-one",
    "request-token-one",
    "request-secret-one",
    "discogs-verifier-one",
    "access-token-one",
    "access-secret-one",
  ]) {
    assert.equal(persisted.includes(forbidden), false);
  }

  const replay = await withRuntime(database, () =>
    completeDiscogsOAuth({
      resumeState: staged.resumeState,
      actorEmail: ownerEmail,
      browserNonce,
      requestUrl: localResumeUrl,
    }),
  );
  assert.deepEqual(replay, { status: "invalid_state" });
});

test("Discogs rejects pre-deploy callback state without an explicit replacement intent", async () => {
  const database = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(database, browserNonce);
  const staged = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(started.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-one",
      browserNonce,
      requestUrl: callbackUrl,
    }),
  );
  assert.equal(staged.status, "ready");

  const [stored] = database.transactions.values();
  const current = await decryptCredential(
    stored,
    encryptionKey,
    "discogs-oauth-transaction",
  );
  const legacyTransaction = { ...current };
  delete legacyTransaction.replaceExisting;
  Object.assign(
    stored,
    await encryptCredential(
      legacyTransaction,
      encryptionKey,
      "discogs-oauth-transaction",
    ),
  );

  const result = await withRuntime(database, () =>
    completeDiscogsOAuth({
      resumeState: staged.resumeState,
      actorEmail: ownerEmail,
      browserNonce,
      requestUrl: localResumeUrl,
    }),
  );
  assert.deepEqual(result, { status: "invalid_state" });
  assert.equal(stored.consumedAt, null);
  assert.equal(database.credentials.size, 0);
});

test("routine Discogs reauthorization preserves state and rebinds presentation", async () => {
  const database = new DiscogsOAuthD1();
  const firstBrowserNonce = createDiscogsOAuthBrowserNonce();
  const initial = await begin(database, firstBrowserNonce);
  const initialStage = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(initial.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-one",
      browserNonce: firstBrowserNonce,
      requestUrl: callbackUrl,
    }),
  );
  await withRuntime(database, () =>
    withFetch(requestTokenFetch(), () =>
      completeDiscogsOAuth({
        resumeState: initialStage.resumeState,
        actorEmail: ownerEmail,
        browserNonce: firstBrowserNonce,
        requestUrl: localResumeUrl,
      }),
    ),
  );
  database.snapshots.push({ id: "accepted" });
  database.runs.push({ id: "history" });
  database.presentationSetting = {
    schemaVersion: 1,
    publishCollection: true,
    reviewedAt: "2026-08-01T00:00:00.000Z",
    credentialGeneration: 1,
  };

  const secondBrowserNonce = createDiscogsOAuthBrowserNonce();
  const routine = await withRuntime(database, () =>
    withFetch(requestTokenFetch(), () =>
      startDiscogsOAuth({
        actorEmail: ownerEmail,
        browserNonce: secondBrowserNonce,
        requestUrl: startUrl,
      }),
    ),
  );
  const routineStage = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(routine.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-two",
      browserNonce: secondBrowserNonce,
      requestUrl: callbackUrl,
    }),
  );
  const result = await withRuntime(database, () =>
    withFetch(requestTokenFetch(), () =>
      completeDiscogsOAuth({
        resumeState: routineStage.resumeState,
        actorEmail: ownerEmail,
        browserNonce: secondBrowserNonce,
        requestUrl: localResumeUrl,
      }),
    ),
  );

  assert.deepEqual(result, { status: "connected" });
  assert.equal(database.credentials.get("discogs").generation, 2);
  assert.deepEqual(database.snapshots, [{ id: "accepted" }]);
  assert.deepEqual(database.runs, [{ id: "history" }]);
  assert.equal(database.presentationSetting.publishCollection, true);
  assert.equal(database.presentationSetting.credentialGeneration, 2);
});

test("Discogs never retries the consumed access-token exchange", async () => {
  const database = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(database, browserNonce);
  const staged = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(started.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-one",
      browserNonce,
      requestUrl: callbackUrl,
    }),
  );
  let exchanges = 0;
  const completed = await withRuntime(database, () =>
    withFetch(
      async (url) => {
        assert.equal(url, DISCOGS_ACCESS_TOKEN_ENDPOINT);
        exchanges += 1;
        return form("", 503);
      },
      () =>
        completeDiscogsOAuth({
          resumeState: staged.resumeState,
          actorEmail: ownerEmail,
          browserNonce,
          requestUrl: localResumeUrl,
        }),
    ),
  );

  assert.deepEqual(completed, { status: "provider_unavailable" });
  assert.equal(exchanges, 1);
  assert.equal(database.credentials.size, 0);
});

test("Discogs denial and 401 completion are safe terminal states", async () => {
  const deniedDatabase = new DiscogsOAuthD1();
  const deniedBrowser = createDiscogsOAuthBrowserNonce();
  const started = await begin(deniedDatabase, deniedBrowser);
  const requestToken = new URL(started.authorizationUrl).searchParams.get(
    "oauth_token",
  );
  const stagedDenial = await withRuntime(deniedDatabase, () =>
    stageDiscogsOAuthCallback({
      requestToken,
      denied: true,
      browserNonce: deniedBrowser,
      requestUrl: callbackUrl,
    }),
  );
  const denied = await withRuntime(deniedDatabase, () =>
    completeDiscogsOAuth({
      resumeState: stagedDenial.resumeState,
      actorEmail: ownerEmail,
      browserNonce: deniedBrowser,
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(denied, { status: "denied" });
  assert.equal(deniedDatabase.transactions.size, 0);
  assert.equal(deniedDatabase.credentials.size, 0);

  const rejectedDatabase = new DiscogsOAuthD1();
  const rejectedBrowser = createDiscogsOAuthBrowserNonce();
  const rejectedStart = await begin(rejectedDatabase, rejectedBrowser);
  const rejectedStage = await withRuntime(rejectedDatabase, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(rejectedStart.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-rejected",
      browserNonce: rejectedBrowser,
      requestUrl: callbackUrl,
    }),
  );
  const rejected = await withRuntime(rejectedDatabase, () =>
    withFetch(requestTokenFetch({ accessStatus: 401 }), () =>
      completeDiscogsOAuth({
        resumeState: rejectedStage.resumeState,
        actorEmail: ownerEmail,
        browserNonce: rejectedBrowser,
        requestUrl: callbackUrl,
      }),
    ),
  );
  assert.deepEqual(rejected, { status: "reauthorization_required" });
  assert.equal(rejectedDatabase.transactions.size, 0);
  assert.equal(rejectedDatabase.credentials.size, 0);
});

test("Discogs expired state is removed without provider exchange", async () => {
  const database = new DiscogsOAuthD1();
  const browserNonce = createDiscogsOAuthBrowserNonce();
  const started = await begin(database, browserNonce);
  const [transaction] = database.transactions.values();
  transaction.expiresAt = new Date(Date.now() - 1_000).toISOString();

  const result = await withRuntime(database, () =>
    stageDiscogsOAuthCallback({
      requestToken: new URL(started.authorizationUrl).searchParams.get(
        "oauth_token",
      ),
      oauthVerifier: "discogs-verifier-expired",
      browserNonce,
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(result, { status: "expired" });
  assert.equal(database.transactions.size, 0);
  assert.equal(database.credentials.size, 0);
});

test("Discogs stays OAuth-only and Studio recognizes pending/reusable authorization", async () => {
  const [credentialsSource, overviewSource] = await Promise.all([
    readFile(
      new URL("../lib/server/http/connector-credentials.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../lib/server/connectors/repository-overview.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    credentialsSource,
    /provider === "discogs"[\s\S]*?oauth_required/,
  );
  assert.match(
    overviewSource,
    /pendingAuthorization[\s\S]*?provider === "discogs"/,
  );
  assert.match(
    overviewSource,
    /canReuseOAuthClient:[\s\S]*?provider === "discogs"/,
  );
});
