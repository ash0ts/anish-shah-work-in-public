import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  {
    MYANIMELIST_CALLBACK_PATH,
    MYANIMELIST_TOKEN_ENDPOINT,
    buildMyAnimeListAuthorizationUrl,
    createMyAnimeListOAuthState,
    createMyAnimeListPkceVerifier,
    exchangeMyAnimeListAuthorizationCode,
    hashMyAnimeListOAuthState,
    refreshMyAnimeListOAuthCredential,
    resolveMyAnimeListCallbackUrl,
    shouldRefreshMyAnimeListToken,
  },
  { decryptCredential },
  {
    completeMyAnimeListOAuth,
    deleteConnectorCredential,
    stageMyAnimeListOAuthCallback,
    startMyAnimeListOAuth,
  },
  { ConnectorFetchError },
] = await Promise.all([
  import("../lib/server/connectors/myanimelist-oauth.ts"),
  import("../lib/server/credential-crypto.ts"),
  import("../lib/server/connectors/repository.ts"),
  import("../lib/server/connectors/types.ts"),
]);

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withRuntimeBindings(bindings, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = bindings;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

class OAuthStatement {
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

class OAuthD1 {
  constructor() {
    this.transactions = new Map();
    this.credentials = new Map();
    this.snapshots = [];
    this.runs = [];
    this.audits = [];
  }

  prepare(sql) {
    return new OAuthStatement(this, sql);
  }

  async first(statement) {
    if (statement.sql.includes("FROM connector_oauth_transactions")) {
      return this.transactions.get(statement.values[0]) ?? null;
    }
    if (statement.sql.includes("FROM connector_credentials")) {
      return this.credentials.get(statement.values[0]) ?? null;
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
    const sql = statement.sql;
    const values = statement.values;

    if (sql.startsWith("INSERT INTO connector_oauth_transactions")) {
      const [
        stateHash,
        ciphertext,
        iv,
        keyVersion,
        ownerEmail,
        redirectUri,
        expiresAt,
        createdAt,
      ] = values;
      this.transactions.set(stateHash, {
        stateHash,
        ciphertext,
        iv,
        keyVersion,
        ownerEmail,
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
      const [
        replacementHash,
        ciphertext,
        iv,
        keyVersion,
        originalHash,
        now,
      ] = values;
      const current = this.transactions.get(originalHash);
      if (
        !current ||
        current.consumedAt ||
        current.expiresAt <= now
      ) {
        return 0;
      }
      this.transactions.delete(originalHash);
      this.transactions.set(replacementHash, {
        ...current,
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
      const current = this.transactions.get(stateHash);
      if (
        !current ||
        current.consumedAt ||
        current.expiresAt <= now
      ) {
        return 0;
      }
      current.consumedAt = consumedAt;
      return 1;
    }

    if (sql.startsWith("DELETE FROM connector_oauth_transactions")) {
      let deleted = 0;
      if (sql.includes("state_hash = ?")) {
        deleted = this.transactions.delete(values[0]) ? 1 : 0;
      } else if (
        sql.includes("expires_at <= ?") &&
        !sql.includes("owner_email = ?")
      ) {
        const [now] = values;
        for (const [key, transaction] of this.transactions) {
          if (transaction.expiresAt <= now) {
            this.transactions.delete(key);
            deleted += 1;
          }
        }
      } else if (sql.includes("owner_email = ?")) {
        const [ownerEmail, ciphertext, iv, updatedAt] = values;
        if (sql.includes("EXISTS")) {
          const credential = this.credentials.get("myanimelist");
          if (
            !credential ||
            credential.ciphertext !== ciphertext ||
            credential.iv !== iv ||
            credential.updatedAt !== updatedAt
          ) {
            return 0;
          }
        }
        for (const [key, transaction] of this.transactions) {
          if (transaction.ownerEmail === ownerEmail) {
            this.transactions.delete(key);
            deleted += 1;
          }
        }
      } else if (sql.includes("WHERE provider = ?")) {
        const [provider] = values;
        for (const key of this.transactions.keys()) {
          if (provider === "myanimelist") {
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
        credentialLabel,
        expiresAt,
        createdAt,
        updatedAt,
        stateHash,
        ownerEmail,
        now,
      ] = values;
      const transaction = this.transactions.get(stateHash);
      if (
        !transaction ||
        transaction.ownerEmail !== ownerEmail ||
        !transaction.consumedAt ||
        transaction.expiresAt <= now
      ) {
        return 0;
      }
      const previous = this.credentials.get("myanimelist");
      this.credentials.set("myanimelist", {
        ciphertext,
        iv,
        keyVersion,
        credentialLabel,
        expiresAt,
        createdAt,
        updatedAt,
        generation: previous ? previous.generation + 1 : 1,
      });
      return 1;
    }

    if (sql.startsWith("DELETE FROM connector_credentials")) {
      return this.credentials.delete(values[0]) ? 1 : 0;
    }

    if (sql.startsWith("DELETE FROM connector_snapshots")) {
      const provider = sql.includes("provider = 'myanimelist'")
        ? "myanimelist"
        : values[0];
      const before = this.snapshots.length;
      this.snapshots = this.snapshots.filter(
        (snapshot) => snapshot.provider !== provider,
      );
      return before - this.snapshots.length;
    }

    if (sql.startsWith("DELETE FROM sync_runs")) {
      const provider = sql.includes("provider = 'myanimelist'")
        ? "myanimelist"
        : values[0];
      const before = this.runs.length;
      this.runs = this.runs.filter((run) => run.provider !== provider);
      return before - this.runs.length;
    }

    if (sql.startsWith("DELETE FROM audit_log")) {
      const provider = values[0];
      const before = this.audits.length;
      this.audits = this.audits.filter(
        (audit) => !audit.values.includes(provider),
      );
      return before - this.audits.length;
    }

    if (sql.startsWith("INSERT INTO audit_log")) {
      if (
        sql.includes("connector.oauth_connected") &&
        !this.credentials.has("myanimelist")
      ) {
        return 0;
      }
      this.audits.push({ sql, values: structuredClone(values) });
      return 1;
    }

    return 0;
  }
}

const localOAuthEnvironment = {
  CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString("base64"),
  NODE_ENV: "development",
  SITE_URL: "http://localhost:3000",
};
const oauthStartUrl =
  "http://localhost:3000/api/connectors/myanimelist/oauth/start";
const oauthCallbackUrl =
  "http://localhost:3000/api/connectors/myanimelist/oauth/callback";

async function beginOAuth(database, ownerEmail = "Owner@Example.com") {
  return withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      startMyAnimeListOAuth({
        clientId: "client-id-value",
        clientSecret: "client-secret-value",
        actorEmail: ownerEmail,
        requestUrl: oauthStartUrl,
      }),
  );
}

test("MyAnimeList OAuth state and plain PKCE are high entropy and URL-safe", async () => {
  const state = createMyAnimeListOAuthState();
  const secondState = createMyAnimeListOAuthState();
  const verifier = createMyAnimeListPkceVerifier();
  const clientId = "client-id-safe-to-display";
  const clientSecret = "client-secret-must-not-leak";
  const authorizationUrl = buildMyAnimeListAuthorizationUrl({
    clientId,
    codeVerifier: verifier,
    redirectUri: oauthCallbackUrl,
    state,
  });
  const parsed = new URL(authorizationUrl);

  assert.notEqual(state, secondState);
  assert.match(state, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(parsed.origin, "https://myanimelist.net");
  assert.equal(parsed.pathname, "/v1/oauth2/authorize");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("client_id"), clientId);
  assert.equal(parsed.searchParams.get("redirect_uri"), oauthCallbackUrl);
  assert.equal(parsed.searchParams.get("code_challenge"), verifier);
  assert.equal(parsed.searchParams.get("code_challenge_method"), "plain");
  assert.equal(parsed.searchParams.get("state"), state);
  assert.equal(authorizationUrl.includes(clientSecret), false);

  const hashed = await hashMyAnimeListOAuthState(state);
  assert.match(hashed, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashed.includes(state), false);
});

test("MyAnimeList callback is pinned to the exact configured origin", () => {
  assert.equal(
    resolveMyAnimeListCallbackUrl(
      "http://localhost:3000/api/connectors/myanimelist/oauth/start",
      "http://localhost:3000",
      "development",
    ),
    `http://localhost:3000${MYANIMELIST_CALLBACK_PATH}`,
  );
  assert.equal(
    resolveMyAnimeListCallbackUrl(
      "https://anish.example/api/connectors/myanimelist/oauth/start",
      "https://anish.example",
      "production",
    ),
    `https://anish.example${MYANIMELIST_CALLBACK_PATH}`,
  );

  for (const [requestUrl, siteUrl, environment] of [
    [
      "http://127.0.0.1:3000/api/connectors/myanimelist/oauth/start",
      "http://127.0.0.1:3000",
      "development",
    ],
    [
      "http://localhost:3001/api/connectors/myanimelist/oauth/start",
      "http://localhost:3001",
      "development",
    ],
    [
      "https://evil.example/api/connectors/myanimelist/oauth/start",
      "https://anish.example",
      "production",
    ],
    [
      "http://anish.example/api/connectors/myanimelist/oauth/start",
      "http://anish.example",
      "production",
    ],
  ]) {
    assert.equal(
      resolveMyAnimeListCallbackUrl(requestUrl, siteUrl, environment),
      null,
    );
  }
});

test("OAuth transactions are encrypted, owner-bound, expiring, and callback-bound", async () => {
  const database = new OAuthD1();
  const started = await beginOAuth(database);
  assert.equal(started.status, "authorization_required");

  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const [stored] = database.transactions.values();
  assert.equal(database.transactions.has(state), false);
  assert.equal(stored.ownerEmail, "owner@example.com");
  assert.equal(stored.redirectUri, oauthCallbackUrl);
  assert(Date.parse(stored.expiresAt) - Date.now() <= 10 * 60 * 1000);
  assert(Date.parse(stored.expiresAt) > Date.now());
  assert.equal(JSON.stringify(stored).includes("client-secret-value"), false);

  const decrypted = await decryptCredential(
    stored,
    localOAuthEnvironment.CONNECTOR_ENCRYPTION_KEY,
    "myanimelist-oauth-transaction",
  );
  assert.equal(decrypted.clientSecret, "client-secret-value");
  assert.equal(decrypted.phase, "authorization");
  assert.equal(decrypted.ownerEmail, "owner@example.com");
  assert.equal(decrypted.stateHash, stored.stateHash);

  const mismatch = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state,
        authorizationCode: "authorization-code-value",
        requestUrl:
          "http://localhost:3001/api/connectors/myanimelist/oauth/callback",
      }),
  );
  assert.deepEqual(mismatch, { status: "setup_required" });

  stored.expiresAt = new Date(Date.now() - 1_000).toISOString();
  const expired = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state,
        authorizationCode: "authorization-code-value",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.deepEqual(expired, { status: "expired" });
  assert.equal(database.transactions.size, 0);
});

test("OAuth completion rejects the wrong owner and replay, then stores renewable tokens", async () => {
  const database = new OAuthD1();
  const started = await beginOAuth(database);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const staged = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state,
        authorizationCode: "authorization-code-value",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.equal(staged.status, "ready");

  const wrongOwner = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      completeMyAnimeListOAuth({
        resumeState: staged.resumeState,
        actorEmail: "someone-else@example.com",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.deepEqual(wrongOwner, { status: "invalid_state" });

  let tokenRequests = 0;
  const completed = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      withFetch(async () => {
        tokenRequests += 1;
        return jsonResponse({
          expires_in: 3600,
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
        });
      }, () =>
        completeMyAnimeListOAuth({
          resumeState: staged.resumeState,
          actorEmail: "owner@example.com",
          requestUrl: oauthCallbackUrl,
        }),
      ),
  );
  assert.deepEqual(completed, { status: "connected" });
  assert.equal(tokenRequests, 1);
  assert.equal(database.transactions.size, 0);

  const storedCredential = await decryptCredential(
    database.credentials.get("myanimelist"),
    localOAuthEnvironment.CONNECTOR_ENCRYPTION_KEY,
    "myanimelist",
  );
  assert.equal(storedCredential.clientSecret, "client-secret-value");
  assert.equal(storedCredential.accessToken, "access-token-value");
  assert.equal(storedCredential.refreshToken, "refresh-token-value");
  assert.equal(JSON.stringify(database.audits).includes("access-token-value"), false);

  const replay = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      completeMyAnimeListOAuth({
        resumeState: staged.resumeState,
        actorEmail: "owner@example.com",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.deepEqual(replay, { status: "invalid_state" });
  assert.equal(tokenRequests, 1);
});

test("OAuth denial consumes the transaction without creating credentials", async () => {
  const database = new OAuthD1();
  const started = await beginOAuth(database);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const staged = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state,
        providerError: "access_denied",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.equal(staged.status, "ready");

  const denied = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      completeMyAnimeListOAuth({
        resumeState: staged.resumeState,
        actorEmail: "owner@example.com",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.deepEqual(denied, { status: "denied" });
  assert.equal(database.credentials.size, 0);
  assert.equal(database.transactions.size, 0);
});

test("disconnect during token exchange cannot resurrect MyAnimeList", async () => {
  const database = new OAuthD1();
  const started = await beginOAuth(database);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const staged = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state,
        authorizationCode: "authorization-code-value",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.equal(staged.status, "ready");

  let exchangeStarted = false;
  let releaseExchange;
  const exchangeResponse = new Promise((resolve) => {
    releaseExchange = resolve;
  });

  await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      withFetch(async () => {
        exchangeStarted = true;
        return exchangeResponse;
      }, async () => {
        const completion = completeMyAnimeListOAuth({
          resumeState: staged.resumeState,
          actorEmail: "owner@example.com",
          requestUrl: oauthCallbackUrl,
        });
        while (!exchangeStarted) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        await deleteConnectorCredential(
          "myanimelist",
          "owner@example.com",
        );
        releaseExchange(
          jsonResponse({
            expires_in: 3600,
            access_token: "late-access-token",
            refresh_token: "late-refresh-token",
          }),
        );

        assert.deepEqual(await completion, {
          status: "invalid_state",
        });
      }),
  );

  assert.equal(database.credentials.size, 0);
  assert.equal(database.transactions.size, 0);
  assert.equal(
    database.audits.some(({ sql }) =>
      sql.includes("connector.oauth_connected"),
    ),
    false,
  );
});

test("a new authorization supersedes an older in-flight token exchange", async () => {
  const database = new OAuthD1();
  const first = await beginOAuth(database);
  const firstState = new URL(first.authorizationUrl).searchParams.get("state");
  const staged = await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      stageMyAnimeListOAuthCallback({
        state: firstState,
        authorizationCode: "authorization-code-value",
        requestUrl: oauthCallbackUrl,
      }),
  );
  assert.equal(staged.status, "ready");

  let exchangeStarted = false;
  let releaseExchange;
  const exchangeResponse = new Promise((resolve) => {
    releaseExchange = resolve;
  });

  await withRuntimeBindings(
    { ...localOAuthEnvironment, DB: database },
    () =>
      withFetch(async () => {
        exchangeStarted = true;
        return exchangeResponse;
      }, async () => {
        const oldCompletion = completeMyAnimeListOAuth({
          resumeState: staged.resumeState,
          actorEmail: "owner@example.com",
          requestUrl: oauthCallbackUrl,
        });
        while (!exchangeStarted) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        const replacement = await beginOAuth(
          database,
          "owner@example.com",
        );
        assert.equal(replacement.status, "authorization_required");
        releaseExchange(
          jsonResponse({
            expires_in: 3600,
            access_token: "superseded-access-token",
            refresh_token: "superseded-refresh-token",
          }),
        );
        assert.deepEqual(await oldCompletion, {
          status: "invalid_state",
        });

        const replacementState = new URL(
          replacement.authorizationUrl,
        ).searchParams.get("state");
        const replacementHash =
          await hashMyAnimeListOAuthState(replacementState);
        assert.equal(database.transactions.has(replacementHash), true);
      }),
  );

  assert.equal(database.credentials.size, 0);
});

test("OAuth completion distinguishes provider recovery from local persistence failure", async (context) => {
  for (const scenario of [
    {
      name: "rate limit",
      response: jsonResponse({ error: "slow_down" }, { status: 429 }),
      expected: { status: "rate_limited" },
    },
    {
      name: "provider outage",
      response: jsonResponse({ error: "server_error" }, { status: 503 }),
      expected: { status: "provider_unavailable" },
    },
  ]) {
    await context.test(scenario.name, async () => {
      const database = new OAuthD1();
      const started = await beginOAuth(database);
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      const staged = await withRuntimeBindings(
        { ...localOAuthEnvironment, DB: database },
        () =>
          stageMyAnimeListOAuthCallback({
            state,
            authorizationCode: "authorization-code-value",
            requestUrl: oauthCallbackUrl,
          }),
      );

      const result = await withRuntimeBindings(
        { ...localOAuthEnvironment, DB: database },
        () =>
          withFetch(
            async () => scenario.response,
            () =>
              completeMyAnimeListOAuth({
                resumeState: staged.resumeState,
                actorEmail: "owner@example.com",
                requestUrl: oauthCallbackUrl,
              }),
          ),
      );
      assert.deepEqual(result, scenario.expected);
      assert.equal(database.transactions.size, 0);
      assert.equal(database.credentials.size, 0);
    });
  }

  await context.test("D1 save failure", async () => {
    const database = new OAuthD1();
    const started = await beginOAuth(database);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const staged = await withRuntimeBindings(
      { ...localOAuthEnvironment, DB: database },
      () =>
        stageMyAnimeListOAuthCallback({
          state,
          authorizationCode: "authorization-code-value",
          requestUrl: oauthCallbackUrl,
        }),
    );
    const originalBatch = database.batch.bind(database);
    database.batch = async (statements) => {
      if (
        statements.some((statement) =>
          statement.sql.startsWith("INSERT INTO connector_credentials"),
        )
      ) {
        throw new Error("simulated D1 write failure");
      }
      return originalBatch(statements);
    };

    const result = await withRuntimeBindings(
      { ...localOAuthEnvironment, DB: database },
      () =>
        withFetch(
          async () =>
            jsonResponse({
              expires_in: 3600,
              access_token: "access-token-value",
              refresh_token: "refresh-token-value",
            }),
          () =>
            completeMyAnimeListOAuth({
              resumeState: staged.resumeState,
              actorEmail: "owner@example.com",
              requestUrl: oauthCallbackUrl,
            }),
        ),
    );
    assert.deepEqual(result, { status: "setup_required" });
    assert.equal(database.transactions.size, 0);
    assert.equal(database.credentials.size, 0);
  });
});

test("authorization-code exchange sends secrets only in the token request body", async () => {
  const requests = [];
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const credential = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse({
      token_type: "Bearer",
      expires_in: 3600,
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  }, () =>
    exchangeMyAnimeListAuthorizationCode({
      clientId: "client-id-value",
      clientSecret: "client-secret-value",
      authorizationCode: "authorization-code-value",
      codeVerifier: "pkce-verifier-value",
      redirectUri: oauthCallbackUrl,
      now,
    }),
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, MYANIMELIST_TOKEN_ENDPOINT);
  assert.equal(requests[0].url.includes("client-secret-value"), false);
  assert.equal(requests[0].init.method, "POST");
  const body = new URLSearchParams(requests[0].init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_id"), "client-id-value");
  assert.equal(body.get("client_secret"), "client-secret-value");
  assert.equal(body.get("code"), "authorization-code-value");
  assert.equal(body.get("code_verifier"), "pkce-verifier-value");
  assert.equal(body.get("redirect_uri"), oauthCallbackUrl);
  assert.deepEqual(credential, {
    kind: "oauth",
    clientId: "client-id-value",
    clientSecret: "client-secret-value",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: "2026-07-30T13:00:00.000Z",
  });
});

test("refresh rotates tokens, retains an omitted refresh token, and uses expiry skew", async () => {
  const original = {
    kind: "oauth",
    clientId: "client-id-value",
    clientSecret: "client-secret-value",
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
    accessTokenExpiresAt: "2026-07-30T12:04:00.000Z",
  };
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  assert.equal(shouldRefreshMyAnimeListToken(original, now), true);

  const requestBodies = [];
  const refreshed = await withFetch(async (_input, init) => {
    requestBodies.push(new URLSearchParams(init.body));
    return jsonResponse({
      expires_in: 7200,
      access_token: "new-access-token",
    });
  }, () => refreshMyAnimeListOAuthCredential(original, now));

  assert.equal(requestBodies[0].get("grant_type"), "refresh_token");
  assert.equal(requestBodies[0].get("refresh_token"), "old-refresh-token");
  assert.equal(refreshed.accessToken, "new-access-token");
  assert.equal(refreshed.refreshToken, "old-refresh-token");
  assert.equal(refreshed.accessTokenExpiresAt, "2026-07-30T14:00:00.000Z");

  const rotated = await withFetch(
    async () =>
      jsonResponse({
        expires_in: 7200,
        access_token: "rotated-access-token",
        refresh_token: "rotated-refresh-token",
      }),
    () => refreshMyAnimeListOAuthCredential(original, now),
  );
  assert.equal(rotated.refreshToken, "rotated-refresh-token");
});

test("invalid refresh grant becomes reauthorization_required without leaking provider data", async () => {
  await withFetch(
    async () =>
      jsonResponse(
        {
          error: "invalid_grant",
          error_description: "sensitive provider detail",
        },
        { status: 400 },
      ),
    async () => {
      await assert.rejects(
        () =>
          refreshMyAnimeListOAuthCredential({
            kind: "oauth",
            clientId: "client-id-value",
            clientSecret: "client-secret-value",
            accessToken: "old-access-token",
            refreshToken: "revoked-refresh-token",
            accessTokenExpiresAt: "2026-07-30T12:00:00.000Z",
          }),
        (error) => {
          assert(error instanceof ConnectorFetchError);
          assert.equal(error.code, "reauthorization_required");
          assert.equal(error.httpStatus, 400);
          assert.doesNotMatch(error.message, /sensitive|invalid_grant/i);
          return true;
        },
      );
    },
  );
});

test("malformed token responses and provider failures stay safely classified", async (context) => {
  const credential = {
    kind: "oauth",
    clientId: "client-id-value",
    clientSecret: "client-secret-value",
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
    accessTokenExpiresAt: "2026-07-30T12:00:00.000Z",
  };

  for (const scenario of [
    {
      name: "malformed access token",
      response: jsonResponse({
        expires_in: 3600,
        access_token: "unsafe\naccess-token",
        refresh_token: "refresh-token",
      }),
      code: "oauth_token_response_invalid",
      retryable: false,
    },
    {
      name: "malformed replacement refresh token",
      response: jsonResponse({
        expires_in: 3600,
        access_token: "new-access-token",
        refresh_token: "unsafe refresh token",
      }),
      code: "oauth_token_response_invalid",
      retryable: false,
    },
    {
      name: "rate limited",
      response: jsonResponse({ error: "slow_down" }, { status: 429 }),
      code: "rate_limited",
      retryable: true,
    },
    {
      name: "provider failure",
      response: jsonResponse({ error: "server_error" }, { status: 503 }),
      code: "provider_error",
      retryable: true,
    },
  ]) {
    await context.test(scenario.name, async () => {
      await withFetch(async () => scenario.response, async () => {
        await assert.rejects(
          () => refreshMyAnimeListOAuthCredential(credential),
          (error) => {
            assert(error instanceof ConnectorFetchError);
            assert.equal(error.code, scenario.code);
            assert.equal(error.retryable, scenario.retryable);
            return true;
          },
        );
      });
    });
  }
});

test("OAuth routes and migration preserve the server-only privacy boundary", async () => {
  const [
    oauthRepository,
    callbackRoute,
    resumeRoute,
    migration,
    generationMigration,
  ] = await Promise.all([
    readFile(
      new URL(
        "../lib/server/connectors/repository-myanimelist-oauth.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/connectors/myanimelist/oauth/callback/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/studio/oauth-resume/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0002_secure_mal_oauth.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../drizzle/0003_breezy_donald_blake.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(oauthRepository, /hashMyAnimeListOAuthState\(state\)/);
  assert.match(oauthRepository, /encryptCredential\(/);
  assert.match(oauthRepository, /consumed_at IS NULL AND expires_at > \?/);
  assert.match(oauthRepository, /owner_email AS ownerEmail/);
  assert.match(callbackRoute, /chatGPTSignInPath\(returnTo\)/);
  assert.match(callbackRoute, /runtimeValue\("AUTH_MODE"\) === "cloudflare_access"/);
  assert.match(callbackRoute, /new URL\("\/studio\/oauth-resume", site\)/);
  assert.match(callbackRoute, /\?resume=/);
  assert.match(callbackRoute, /runtimeValue\("SITE_URL"\)/);
  assert.match(callbackRoute, /configured\.origin !== requestUrl\.origin/);
  assert.doesNotMatch(callbackRoute, /rejectCrossOriginWrite/);
  assert.doesNotMatch(callbackRoute, /error_description/);
  assert.match(resumeRoute, /requireChatGPTUser\(returnTo\)/);
  assert.match(resumeRoute, /isValidMyAnimeListOAuthState\(resumeState\)/);
  assert.match(resumeRoute, /ownerAuthorizationForEmail\(user\.email\)/);
  assert.match(resumeRoute, /completeMyAnimeListOAuth\(/);
  assert.match(resumeRoute, /requestUrl:\s*callbackUrl/);
  assert.match(migration, /`state_hash` text PRIMARY KEY NOT NULL/);
  assert.match(migration, /`ciphertext` text NOT NULL/);
  assert.doesNotMatch(migration, /authorization_code|client_secret|access_token/);
  assert.match(
    generationMigration,
    /ADD `generation` integer DEFAULT 1 NOT NULL/,
  );
});

test("Studio keeps a manual MyAnimeList continuation when automatic navigation stalls", async () => {
  const controls = (
    await Promise.all(
      [
        "../app/studio/ConnectorControls.tsx",
        "../app/studio/connectors/ApiConnectorPanel.tsx",
        "../app/studio/connectors/helpers.ts",
        "../app/studio/connectors/MyAnimeListConnectorPanel.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");

  assert.match(
    controls,
    /safeAuthorizationUrl\(\s*oauth\.provider,\s*result\.authorizationUrl/,
  );
  assert.match(controls, /setAuthorizationDestination\(destination\)/);
  assert.match(controls, /href=\{authorizationDestination\}/);
  assert.match(controls, /Continue to \{oauthProviderTitle\}/);
});
