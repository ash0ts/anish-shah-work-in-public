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
  resolveDiscogsCallbackUrl,
} = oauth;
const {
  completeDiscogsOAuth,
  stageDiscogsOAuthCallback,
  startDiscogsOAuth,
} = repository;
const { decryptCredential } = cryptoModule;

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

function form(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
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
    if (sql.startsWith("DELETE FROM editorial_settings")) {
      const changed = this.presentationSetting === null ? 0 : 1;
      this.presentationSetting = null;
      return changed;
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

function requestTokenFetch({ accessStatus = 200 } = {}) {
  return async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.match(init.headers.Authorization, /^OAuth /);
    assert.equal(init.headers.Authorization.includes("consumer-secret-one"), false);
    if (url === DISCOGS_REQUEST_TOKEN_ENDPOINT) {
      return form(
        "oauth_token=discogs-request-token-one&" +
          "oauth_token_secret=discogs-request-secret-one&" +
          "oauth_callback_confirmed=true",
      );
    }
    assert.equal(url, DISCOGS_ACCESS_TOKEN_ENDPOINT);
    if (accessStatus !== 200) return form("", accessStatus);
    return form(
      "oauth_token=discogs-access-token-one&" +
        "oauth_token_secret=discogs-access-secret-one",
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

test("Discogs callbacks are pinned to exact local and apex origins", () => {
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
