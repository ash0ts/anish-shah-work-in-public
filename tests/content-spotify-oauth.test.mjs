import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [oauthRepository, cryptoModule] = await Promise.all([
  import("../lib/server/connectors/spotify-oauth-repository.ts"),
  import("../lib/server/credential-crypto.ts"),
]);

const {
  completeSpotifyOAuth,
  stageSpotifyOAuthCallback,
  startSpotifyOAuth,
} = oauthRepository;
const { decryptCredential, encryptCredential } = cryptoModule;

const encryptionKey = Buffer.alloc(32, 53).toString("base64");
const ownerEmail = "owner@example.com";
const localEnvironment = {
  CONNECTOR_ENCRYPTION_KEY: encryptionKey,
  NODE_ENV: "development",
  SITE_URL: "http://localhost:3000",
};
const startUrl =
  "http://localhost:3000/api/studio/connectors/spotify/oauth/start";
const callbackUrl =
  "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

class SpotifyOAuthD1 {
  constructor() {
    this.transactions = new Map();
    this.credentials = new Map();
    this.snapshots = [];
    this.runs = [];
    this.audits = [];
    this.settings = new Map();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async first(statement) {
    if (statement.sql.includes("FROM connector_oauth_transactions")) {
      return this.transactions.get(statement.values[0]) ?? null;
    }
    if (statement.sql.includes("FROM connector_credentials")) {
      return this.credentials.get("spotify") ?? null;
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

    const credentialGuardMatches = () => {
      if (!sql.includes("ciphertext = ?")) return true;
      const [ciphertext, iv, updatedAt] = values.slice(-3);
      const credential = this.credentials.get("spotify");
      return Boolean(
        credential &&
          credential.ciphertext === ciphertext &&
          credential.iv === iv &&
          credential.updatedAt === updatedAt,
      );
    };

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
      const [
        replacementHash,
        ciphertext,
        iv,
        keyVersion,
        originalHash,
        now,
      ] = values;
      const transaction = this.transactions.get(originalHash);
      if (
        !transaction ||
        transaction.consumedAt ||
        transaction.expiresAt <= now
      ) {
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
      if (
        !transaction ||
        transaction.consumedAt ||
        transaction.expiresAt <= now
      ) {
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
        return deleted;
      }
      if (sql.includes("provider = ?") && values[0] === "spotify") {
        deleted = this.transactions.size;
        this.transactions.clear();
      }
      return deleted;
    }

    if (sql.startsWith("INSERT INTO connector_credentials")) {
      const [
        ciphertext,
        iv,
        keyVersion,
        scopesJson,
        expiresAt,
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
      const previous = this.credentials.get("spotify");
      this.credentials.set("spotify", {
        ciphertext,
        iv,
        keyVersion,
        scopesJson,
        expiresAt,
        createdAt,
        updatedAt,
        generation: previous ? previous.generation + 1 : 1,
      });
      return 1;
    }

    if (sql.startsWith("DELETE FROM connector_credentials")) {
      return values[0] === "spotify" && this.credentials.delete("spotify")
        ? 1
        : 0;
    }
    if (sql.startsWith("DELETE FROM connector_snapshots")) {
      if (!credentialGuardMatches()) return 0;
      if (
        sql.includes("NOT EXISTS") &&
        this.snapshots.length > 0
      ) {
        return 0;
      }
      const previous = this.snapshots.length;
      this.snapshots = [];
      return previous;
    }
    if (sql.startsWith("DELETE FROM sync_runs")) {
      if (!credentialGuardMatches()) return 0;
      const previous = this.runs.length;
      this.runs = [];
      return previous;
    }
    if (sql.startsWith("DELETE FROM editorial_settings")) {
      if (!credentialGuardMatches()) return 0;
      if (
        sql.includes("NOT EXISTS") &&
        this.snapshots.length > 0
      ) {
        return 0;
      }
      return this.settings.delete(values[0]) ? 1 : 0;
    }
    if (sql.startsWith("INSERT INTO editorial_settings")) {
      if (!credentialGuardMatches()) return 0;
      if (
        sql.includes("NOT EXISTS") &&
        this.snapshots.length > 0
      ) {
        return 0;
      }
      const [key, valueJson] = values;
      this.settings.set(key, valueJson);
      return 1;
    }
    if (sql.startsWith("DELETE FROM audit_log")) {
      if (!credentialGuardMatches()) return 0;
      const previous = this.audits.length;
      this.audits = [];
      return previous;
    }
    if (sql.startsWith("INSERT INTO audit_log")) {
      if (
        sql.includes("connector.oauth_connected") &&
        !credentialGuardMatches()
      ) {
        return 0;
      }
      this.audits.push({ sql, values: structuredClone(values) });
      return 1;
    }
    return 0;
  }
}

async function begin(database, overrides = {}) {
  return withRuntime(database, () =>
    startSpotifyOAuth({
      clientId: "spotify-client-id-one",
      clientSecret: "spotify-client-secret-one",
      actorEmail: ownerEmail,
      requestUrl: startUrl,
      ...overrides,
    }),
  );
}

async function stage(database, authorizationUrl, input = {}) {
  const state = new URL(authorizationUrl).searchParams.get("state");
  return withRuntime(database, () =>
    stageSpotifyOAuthCallback({
      state,
      authorizationCode: "spotify-authorization-code-one",
      requestUrl: callbackUrl,
      ...input,
    }),
  );
}

function tokenResponseForRequest(_url, init) {
  const body = new URLSearchParams(init.body);
  const code = body.get("code") ?? "refresh";
  const suffix = code.endsWith("two") ? "two" : "one";
  return json({
    access_token: `spotify-access-token-${suffix}`,
    refresh_token: `spotify-refresh-token-${suffix}`,
    expires_in: 3600,
    token_type: "Bearer",
    scope: "user-top-read user-read-private",
  });
}

test("Spotify OAuth transaction is encrypted, owner-bound, callback-bound, and secret-free", async () => {
  const database = new SpotifyOAuthD1();
  const started = await begin(database);
  assert.equal(started.status, "authorization_required");
  assert.equal(started.callbackUrl, callbackUrl);
  assert.equal(started.authorizationUrl.includes("spotify-client-secret-one"), false);
  assert.equal(database.transactions.size, 1);

  const [transaction] = database.transactions.values();
  assert.equal(transaction.ownerEmail, ownerEmail);
  assert.equal(transaction.redirectUri, callbackUrl);
  assert(Date.parse(transaction.expiresAt) > Date.now());
  assert(Date.parse(transaction.expiresAt) - Date.now() <= 10 * 60 * 1000);
  assert.equal(
    JSON.stringify(transaction).includes("spotify-client-secret-one"),
    false,
  );

  const decrypted = await decryptCredential(
    transaction,
    encryptionKey,
    "spotify-oauth-transaction",
  );
  assert.equal(decrypted.clientSecret, "spotify-client-secret-one");
  assert.equal(decrypted.ownerEmail, ownerEmail);
  assert.equal(decrypted.callbackUrl, callbackUrl);
  assert.equal(decrypted.stateHash, transaction.stateHash);

  transaction.redirectUri = "http://127.0.0.1:3000/wrong-callback";
  const mismatch = await stage(database, started.authorizationUrl);
  assert.deepEqual(mismatch, { status: "invalid_state" });
  assert.equal(database.transactions.size, 1);
});

test("Spotify OAuth expires state and removes the unusable transaction", async () => {
  const database = new SpotifyOAuthD1();
  const started = await begin(database);
  const [transaction] = database.transactions.values();
  transaction.expiresAt = new Date(Date.now() - 1_000).toISOString();

  const result = await stage(database, started.authorizationUrl);
  assert.deepEqual(result, { status: "expired" });
  assert.equal(database.transactions.size, 0);
  assert.equal(database.credentials.size, 0);
});

test("Spotify OAuth rejects the wrong owner, consumes before exchange, and prevents replay", async () => {
  const database = new SpotifyOAuthD1();
  const started = await begin(database);
  const staged = await stage(database, started.authorizationUrl);
  assert.equal(staged.status, "ready");
  const [stagedTransaction] = database.transactions.values();
  assert.equal(
    JSON.stringify(stagedTransaction).includes("spotify-authorization-code-one"),
    false,
  );
  const decryptedStagedTransaction = await decryptCredential(
    stagedTransaction,
    encryptionKey,
    "spotify-oauth-transaction",
  );
  assert.equal(
    decryptedStagedTransaction.authorizationCode,
    "spotify-authorization-code-one",
  );

  const wrongOwner = await withRuntime(database, () =>
    completeSpotifyOAuth({
      resumeState: staged.resumeState,
      actorEmail: "not-the-owner@example.com",
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(wrongOwner, { status: "invalid_state" });
  assert.equal([...database.transactions.values()][0].consumedAt, null);

  let observedConsumed = false;
  const completed = await withRuntime(database, () =>
    withFetch(async (url, init) => {
      observedConsumed = [...database.transactions.values()].every(
        (transaction) => Boolean(transaction.consumedAt),
      );
      return tokenResponseForRequest(url, init);
    }, () =>
      completeSpotifyOAuth({
        resumeState: staged.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );
  assert.deepEqual(completed, { status: "connected" });
  assert.equal(observedConsumed, true);
  assert.equal(database.transactions.size, 0);
  assert.equal(database.credentials.get("spotify").generation, 1);

  const credential = await decryptCredential(
    database.credentials.get("spotify"),
    encryptionKey,
    "spotify",
  );
  assert.equal(credential.accessToken, "spotify-access-token-one");
  assert.equal(credential.refreshToken, "spotify-refresh-token-one");
  assert.equal(
    JSON.stringify(database.credentials.get("spotify")).includes(
      "spotify-access-token-one",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(database.audits).includes("spotify-access-token-one"),
    false,
  );
  assert.equal(
    JSON.stringify(database.audits).includes("spotify-client-secret-one"),
    false,
  );

  const replay = await withRuntime(database, () =>
    completeSpotifyOAuth({
      resumeState: staged.resumeState,
      actorEmail: ownerEmail,
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(replay, { status: "invalid_state" });
});

test("Spotify rejects pre-deploy callback state without an explicit replacement intent", async () => {
  const database = new SpotifyOAuthD1();
  const started = await begin(database);
  const staged = await stage(database, started.authorizationUrl);
  assert.equal(staged.status, "ready");

  const [stored] = database.transactions.values();
  const current = await decryptCredential(
    stored,
    encryptionKey,
    "spotify-oauth-transaction",
  );
  const legacyTransaction = { ...current };
  delete legacyTransaction.replaceExisting;
  Object.assign(
    stored,
    await encryptCredential(
      legacyTransaction,
      encryptionKey,
      "spotify-oauth-transaction",
    ),
  );

  const result = await withRuntime(database, () =>
    completeSpotifyOAuth({
      resumeState: staged.resumeState,
      actorEmail: ownerEmail,
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(result, { status: "invalid_state" });
  assert.equal(stored.consumedAt, null);
  assert.equal(database.credentials.size, 0);
});

test("Spotify OAuth denial consumes and deletes state without creating a credential", async () => {
  const database = new SpotifyOAuthD1();
  const started = await begin(database);
  const staged = await stage(database, started.authorizationUrl, {
    authorizationCode: undefined,
    providerError: "access_denied",
  });
  assert.equal(staged.status, "ready");

  const denied = await withRuntime(database, () =>
    completeSpotifyOAuth({
      resumeState: staged.resumeState,
      actorEmail: ownerEmail,
      requestUrl: callbackUrl,
    }),
  );
  assert.deepEqual(denied, { status: "denied" });
  assert.equal(database.transactions.size, 0);
  assert.equal(database.credentials.size, 0);
});

test("a newer Spotify authorization invalidates pending state and replaces credentials by generation", async () => {
  const database = new SpotifyOAuthD1();
  const superseded = await begin(database);
  const replacement = await begin(database, {
    clientId: "spotify-client-id-two",
    clientSecret: "spotify-client-secret-two",
  });
  assert.equal(database.transactions.size, 1);
  const oldStateResult = await stage(database, superseded.authorizationUrl);
  assert.deepEqual(oldStateResult, { status: "invalid_state" });

  const replacementStaged = await stage(database, replacement.authorizationUrl, {
    authorizationCode: "spotify-authorization-code-two",
  });
  const firstCompletion = await withRuntime(database, () =>
    withFetch(tokenResponseForRequest, () =>
      completeSpotifyOAuth({
        resumeState: replacementStaged.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );
  assert.deepEqual(firstCompletion, { status: "connected" });
  assert.equal(database.credentials.get("spotify").generation, 1);
  let credential = await decryptCredential(
    database.credentials.get("spotify"),
    encryptionKey,
    "spotify",
  );
  assert.equal(credential.clientId, "spotify-client-id-two");
  assert.equal(credential.accessToken, "spotify-access-token-two");

  const third = await begin(database, {
    clientId: "spotify-client-id-three",
    clientSecret: "spotify-client-secret-three",
  });
  const thirdStaged = await stage(database, third.authorizationUrl, {
    authorizationCode: "spotify-authorization-code-one",
  });
  const secondCompletion = await withRuntime(database, () =>
    withFetch(tokenResponseForRequest, () =>
      completeSpotifyOAuth({
        resumeState: thirdStaged.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );
  assert.deepEqual(secondCompletion, { status: "connected" });
  assert.equal(database.credentials.get("spotify").generation, 2);
  credential = await decryptCredential(
    database.credentials.get("spotify"),
    encryptionKey,
    "spotify",
  );
  assert.equal(credential.clientId, "spotify-client-id-three");
  assert.equal(credential.accessToken, "spotify-access-token-one");
  assert.equal(database.transactions.size, 0);
});

test("an expired replacement authorization cannot erase the accepted Spotify state", async () => {
  const database = new SpotifyOAuthD1();
  const original = await begin(database);
  const originalStaged = await stage(database, original.authorizationUrl);
  const originalCompletion = await withRuntime(database, () =>
    withFetch(tokenResponseForRequest, () =>
      completeSpotifyOAuth({
        resumeState: originalStaged.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );
  assert.deepEqual(originalCompletion, { status: "connected" });

  database.snapshots.push({ id: "last-known-good" });
  database.runs.push({ id: "last-run" });
  database.audits.push({ id: "last-audit" });
  database.settings.set("connector.spotify.presentation", { valueJson: "{}" });
  database.settings.set("connector.publication_approval.provider.spotify", {
    valueJson: "{}",
  });
  const credentialBefore = structuredClone(database.credentials.get("spotify"));
  const auditsBefore = structuredClone(database.audits);

  const replacement = await begin(database, {
    clientId: "spotify-client-id-two",
    clientSecret: "spotify-client-secret-two",
  });
  const replacementStaged = await stage(database, replacement.authorizationUrl, {
    authorizationCode: "spotify-authorization-code-two",
  });
  const failedReplacement = await withRuntime(database, () =>
    withFetch(async (url, init) => {
      for (const transaction of database.transactions.values()) {
        transaction.expiresAt = new Date(Date.now() - 1_000).toISOString();
      }
      return tokenResponseForRequest(url, init);
    }, () =>
      completeSpotifyOAuth({
        resumeState: replacementStaged.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );

  assert.deepEqual(failedReplacement, { status: "invalid_state" });
  assert.deepEqual(database.credentials.get("spotify"), credentialBefore);
  assert.deepEqual(database.snapshots, [{ id: "last-known-good" }]);
  assert.deepEqual(database.runs, [{ id: "last-run" }]);
  assert.deepEqual(database.audits, auditsBefore);
  assert(database.settings.has("connector.spotify.presentation"));
  assert(database.settings.has("connector.publication_approval.provider.spotify"));
});

test("routine Spotify reauthorization preserves accepted publication state", async () => {
  const database = new SpotifyOAuthD1();
  const initial = await begin(database);
  const initialStage = await stage(database, initial.authorizationUrl);
  await withRuntime(database, () =>
    withFetch(tokenResponseForRequest, () =>
      completeSpotifyOAuth({
        resumeState: initialStage.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );
  database.snapshots.push({ id: "accepted" });
  database.runs.push({ id: "history" });
  database.settings.set("connector.spotify.presentation", "presentation");
  database.settings.set(
    "connector.publication_approval.provider.spotify",
    "approval",
  );

  const routine = await begin(database, {
    clientId: undefined,
    clientSecret: undefined,
  });
  const routineStage = await stage(database, routine.authorizationUrl, {
    authorizationCode: "spotify-authorization-code-two",
  });
  const result = await withRuntime(database, () =>
    withFetch(tokenResponseForRequest, () =>
      completeSpotifyOAuth({
        resumeState: routineStage.resumeState,
        actorEmail: ownerEmail,
        requestUrl: callbackUrl,
      }),
    ),
  );

  assert.deepEqual(result, { status: "connected" });
  assert.equal(database.credentials.get("spotify").generation, 2);
  assert.deepEqual(database.snapshots, [{ id: "accepted" }]);
  assert.deepEqual(database.runs, [{ id: "history" }]);
  assert.equal(
    database.settings.get("connector.spotify.presentation"),
    "presentation",
  );
  assert.equal(
    database.settings.get("connector.publication_approval.provider.spotify"),
    "approval",
  );
});
