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
  { ConnectorFetchError },
] = await Promise.all([
  import("../lib/server/connectors/myanimelist-oauth.ts"),
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

test("MyAnimeList OAuth state and plain PKCE are high entropy and URL-safe", async () => {
  const state = createMyAnimeListOAuthState();
  const secondState = createMyAnimeListOAuthState();
  const verifier = createMyAnimeListPkceVerifier();
  const clientId = "client-id-safe-to-display";
  const clientSecret = "client-secret-must-not-leak";
  const authorizationUrl = buildMyAnimeListAuthorizationUrl({
    clientId,
    codeVerifier: verifier,
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

test("OAuth routes and migration preserve the server-only privacy boundary", async () => {
  const [repository, callbackRoute, migration] = await Promise.all([
    readFile(
      new URL("../lib/server/connectors/repository.ts", import.meta.url),
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
      new URL("../drizzle/0002_secure_mal_oauth.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(repository, /hashMyAnimeListOAuthState\(state\)/);
  assert.match(repository, /encryptCredential\(/);
  assert.match(repository, /consumed_at IS NULL AND expires_at > \?/);
  assert.match(repository, /owner_email AS ownerEmail/);
  assert.match(callbackRoute, /chatGPTSignInPath\(returnTo\)/);
  assert.match(callbackRoute, /\?resume=/);
  assert.doesNotMatch(callbackRoute, /rejectCrossOriginWrite/);
  assert.doesNotMatch(callbackRoute, /error_description/);
  assert.match(migration, /`state_hash` text PRIMARY KEY NOT NULL/);
  assert.match(migration, /`ciphertext` text NOT NULL/);
  assert.doesNotMatch(migration, /authorization_code|client_secret|access_token/);
});
