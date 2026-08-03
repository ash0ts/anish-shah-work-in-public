import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { tsImport } from "tsx/esm/api";

const {
  cloudflareAccessConfigured,
  verifyCloudflareAccess,
  verifyCloudflareAccessPrincipal,
} = await tsImport("../lib/server/cloudflare-access.ts", import.meta.url);

const AUDIENCE = "test-audience-12345678";
const ISSUER = "https://portfolio-test.cloudflareaccess.com";
const NOW = 1_785_516_000;
const KEY_ID = "test-access-key";

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
});
const publicJwk = await exportJWK(publicKey);
Object.assign(publicJwk, { alg: "RS256", kid: KEY_ID, use: "sig" });
const keyResolver = createLocalJWKSet({ keys: [publicJwk] });

const configuration = {
  audience: AUDIENCE,
  teamDomain: ISSUER,
};

async function issueToken(overrides = {}, signingKey = privateKey) {
  return new SignJWT({
    aud: [AUDIENCE],
    email: "owner@example.com",
    exp: NOW + 300,
    iat: NOW,
    iss: ISSUER,
    nbf: NOW,
    type: "app",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .sign(signingKey);
}

function assertionRequest(token) {
  return new Request("https://portfolio.example/studio", {
    headers: { "cf-access-jwt-assertion": token },
  });
}

async function verify(token, request = assertionRequest(token)) {
  return verifyCloudflareAccess(request, configuration, {
    keyResolver,
    nowSeconds: NOW,
  });
}

test("valid Access assertions and authorization cookies resolve the verified email", async () => {
  const token = await issueToken();
  assert.deepEqual(await verify(token), { email: "owner@example.com" });

  const cookieRequest = new Request("https://portfolio.example/studio", {
    headers: { cookie: `session=ignored; CF_Authorization=${token}` },
  });
  assert.deepEqual(await verify(token, cookieRequest), {
    email: "owner@example.com",
  });
});

test("Access verification rejects invalid issuer, audience, email, and expiry", async () => {
  const invalidTokens = await Promise.all([
    issueToken({ iss: "https://other-team.cloudflareaccess.com" }),
    issueToken({ aud: ["different-audience-12345678"] }),
    issueToken({ email: undefined }),
    issueToken({ email: "not-an-email" }),
    issueToken({ exp: NOW - 1 }),
  ]);

  for (const token of invalidTokens) {
    assert.equal(await verify(token), null);
  }
});

test("Access verification rejects assertions signed by an untrusted key", async () => {
  const { privateKey: untrustedKey } = await generateKeyPair("RS256");
  const token = await issueToken({}, untrustedKey);
  assert.equal(await verify(token), null);
});

test("Access configuration and missing assertions fail closed", async () => {
  assert.equal(cloudflareAccessConfigured(configuration), true);
  assert.equal(
    cloudflareAccessConfigured({
      audience: AUDIENCE,
      teamDomain: "https://example.com",
    }),
    false,
  );
  assert.equal(
    await verifyCloudflareAccess(
      new Request("https://portfolio.example/studio"),
      configuration,
      { keyResolver, nowSeconds: NOW },
    ),
    null,
  );
});

test("verified service principals are available only to preview authorization", async () => {
  const token = await issueToken({
    email: undefined,
    type: "app",
    common_name: "e367826f93b8d71185e03fe518aff3b4.access",
    sub: "",
  });
  assert.deepEqual(
    await verifyCloudflareAccessPrincipal(
      assertionRequest(token),
      configuration,
      { keyResolver, nowSeconds: NOW },
    ),
    {
      kind: "service",
      commonName: "e367826f93b8d71185e03fe518aff3b4.access",
    },
  );
  assert.equal(await verify(token), null);

  const malformed = await issueToken({
    email: undefined,
    type: "app",
    common_name: "invalid service name with spaces",
    sub: "",
  });
  assert.equal(
    await verifyCloudflareAccessPrincipal(
      assertionRequest(malformed),
      configuration,
      { keyResolver, nowSeconds: NOW },
    ),
    null,
  );

  const identityShaped = await issueToken({
    email: undefined,
    type: "app",
    common_name: "e367826f93b8d71185e03fe518aff3b4.access",
    sub: "not-empty",
  });
  assert.equal(
    await verifyCloudflareAccessPrincipal(
      assertionRequest(identityShaped),
      configuration,
      { keyResolver, nowSeconds: NOW },
    ),
    null,
  );
});
