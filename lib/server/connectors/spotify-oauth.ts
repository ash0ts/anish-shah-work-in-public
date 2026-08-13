import {
  ConnectorFetchError,
  type SpotifyOAuthCredential,
} from "./types";

export const SPOTIFY_AUTHORIZATION_ENDPOINT =
  "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_ENDPOINT =
  "https://accounts.spotify.com/api/token";
export const SPOTIFY_CALLBACK_PATH =
  "/api/connectors/spotify/oauth/callback";
export const SPOTIFY_OAUTH_SCOPES = [
  "user-top-read",
  "user-read-private",
] as const;

const OAUTH_TIMEOUT_MS = 25_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const RANDOM_STATE_BYTES = 32;
const PKCE_VERIFIER_BYTES = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
};

export type SpotifyOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export type SpotifyOAuthTransactionPayload = SpotifyOAuthClient & {
  phase: "authorization" | "callback";
  replaceExisting: boolean;
  codeVerifier: string;
  callbackUrl: string;
  ownerEmail: string;
  stateHash: string;
  authorizationCode?: string;
  providerError?: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(byteLength)),
  );
}

function normalizeClientValue(
  value: string,
  maximumLength: number,
): string | null {
  const candidate = value.trim();
  if (
    candidate.length < 8 ||
    candidate.length > maximumLength ||
    CONTROL_CHARACTER.test(candidate) ||
    !/^[\x21-\x7e]+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function normalizeOAuthToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  return candidate &&
    candidate.length <= 8192 &&
    !CONTROL_CHARACTER.test(candidate) &&
    !/\s/.test(candidate)
    ? candidate
    : "";
}

export function normalizeSpotifyOAuthClient(
  clientId: string,
  clientSecret: string,
): SpotifyOAuthClient | null {
  const normalizedClientId = normalizeClientValue(clientId, 256);
  const normalizedClientSecret = normalizeClientValue(clientSecret, 2048);
  return normalizedClientId && normalizedClientSecret
    ? { clientId: normalizedClientId, clientSecret: normalizedClientSecret }
    : null;
}

export function createSpotifyOAuthState(): string {
  return randomBase64Url(RANDOM_STATE_BYTES);
}

export function createSpotifyPkceVerifier(): string {
  return randomBase64Url(PKCE_VERIFIER_BYTES);
}

export async function createSpotifyPkceChallenge(
  verifier: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashSpotifyOAuthState(
  state: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function isValidSpotifyOAuthState(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function buildSpotifyAuthorizationUrl(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(SPOTIFY_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", SPOTIFY_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

/**
 * Spotify rejects `localhost` redirect URIs. In development the Studio may
 * remain on localhost, but Spotify always returns to the explicit loopback IP.
 */
export function resolveSpotifyCallbackUrl(
  requestUrl: string,
  configuredSiteUrl: string | undefined,
  nodeEnvironment: string | undefined,
): string | null {
  let request: URL;
  let site: URL;
  try {
    request = new URL(requestUrl);
    site = new URL(configuredSiteUrl ?? "");
  } catch {
    return null;
  }
  if (
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  ) {
    return null;
  }

  if (nodeEnvironment === "development") {
    if (
      site.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(site.hostname) ||
      site.port !== "3000"
    ) {
      return null;
    }
    const callbackOrigin = "http://127.0.0.1:3000";
    if (![site.origin, callbackOrigin].includes(request.origin)) return null;
    return `${callbackOrigin}${SPOTIFY_CALLBACK_PATH}`;
  }

  if (site.protocol !== "https:" || request.origin !== site.origin) {
    return null;
  }
  return new URL(SPOTIFY_CALLBACK_PATH, site).toString();
}

function basicAuthorization(client: SpotifyOAuthClient): string {
  return `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`;
}

function invalidTokenResponse(): ConnectorFetchError {
  return new ConnectorFetchError(
    "Spotify returned an unexpected authorization response.",
    { code: "oauth_token_response_invalid" },
  );
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw invalidTokenResponse();
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw invalidTokenResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidTokenResponse();
  }
}

function parseTokenJson(text: string): TokenResponse {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw invalidTokenResponse();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidTokenResponse();
  }
  return body as TokenResponse;
}

async function tokenFailure(
  response: Response,
  grant: "authorization_code" | "refresh_token",
): Promise<ConnectorFetchError> {
  let providerError: string | null = null;
  try {
    const text = await readBoundedResponseText(
      response,
      MAX_ERROR_RESPONSE_BYTES,
    );
    const body = JSON.parse(text) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string" &&
      /^[a-z0-9_]{1,64}$/i.test(body.error)
    ) {
      providerError = body.error;
    }
  } catch {
    // Provider response bodies are never retained or surfaced.
  }

  if (
    grant === "refresh_token" &&
    (response.status === 400 || response.status === 401) &&
    (providerError === "invalid_grant" || providerError === null)
  ) {
    return new ConnectorFetchError(
      "Spotify authorization needs to be renewed.",
      { code: "reauthorization_required", httpStatus: response.status },
    );
  }
  return new ConnectorFetchError(
    grant === "authorization_code"
      ? "Spotify could not complete authorization."
      : "Spotify could not refresh authorization.",
    {
      code:
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_error"
            : grant === "authorization_code"
              ? "oauth_exchange_failed"
              : "credential_refresh_failed",
      httpStatus: response.status,
      retryable: response.status === 429 || response.status >= 500,
    },
  );
}

async function requestTokens(
  client: SpotifyOAuthClient,
  parameters: URLSearchParams,
  grant: "authorization_code" | "refresh_token",
): Promise<TokenResponse> {
  parameters.set("grant_type", grant);
  let response: Response;
  try {
    response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(client),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: parameters.toString(),
    });
  } catch {
    throw new ConnectorFetchError(
      "Spotify authorization is temporarily unavailable.",
      { code: "provider_error", retryable: true },
    );
  }
  if (!response.ok) throw await tokenFailure(response, grant);

  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") throw invalidTokenResponse();

  return parseTokenJson(
    await readBoundedResponseText(response, MAX_TOKEN_RESPONSE_BYTES),
  );
}

function requiredTokenFields(body: TokenResponse): {
  accessToken: string;
  expiresIn: number;
} {
  const accessToken = normalizeOAuthToken(body.access_token);
  const expiresIn =
    typeof body.expires_in === "number"
      ? body.expires_in
      : typeof body.expires_in === "string" &&
          /^\d+$/.test(body.expires_in)
        ? Number(body.expires_in)
        : Number.NaN;
  if (
    !accessToken ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 24 * 60 * 60 ||
    typeof body.token_type !== "string" ||
    body.token_type.trim().toLowerCase() !== "bearer"
  ) {
    throw invalidTokenResponse();
  }
  return { accessToken, expiresIn };
}

function requiredScopes(
  value: unknown,
  allowOmitted: boolean,
): readonly (typeof SPOTIFY_OAUTH_SCOPES)[number][] | null {
  if (value === undefined && allowOmitted) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2048 ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw invalidTokenResponse();
  }
  const scopes = new Set(value.trim().split(/\s+/));
  if (SPOTIFY_OAUTH_SCOPES.some((scope) => !scopes.has(scope))) {
    throw invalidTokenResponse();
  }
  return SPOTIFY_OAUTH_SCOPES;
}

function tokenExpiry(expiresIn: number, now: number): string {
  return new Date(now + Math.floor(expiresIn * 1000)).toISOString();
}

export async function exchangeSpotifyAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  now?: number;
}): Promise<SpotifyOAuthCredential> {
  const body = await requestTokens(
    { clientId: input.clientId, clientSecret: input.clientSecret },
    new URLSearchParams({
      code: input.authorizationCode,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
    "authorization_code",
  );
  const { accessToken, expiresIn } = requiredTokenFields(body);
  requiredScopes(body.scope, false);
  const refreshToken = normalizeOAuthToken(body.refresh_token);
  if (!refreshToken) {
    throw new ConnectorFetchError(
      "Spotify did not return a renewable authorization.",
      { code: "oauth_token_response_invalid" },
    );
  }
  return {
    kind: "oauth",
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: tokenExpiry(expiresIn, input.now ?? Date.now()),
    scopes: ["user-top-read", "user-read-private"],
  };
}

export function isSpotifyOAuthCredential(
  value: unknown,
): value is SpotifyOAuthCredential {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const credential = value as Partial<SpotifyOAuthCredential>;
  return (
    credential.kind === "oauth" &&
    typeof credential.clientId === "string" &&
    typeof credential.clientSecret === "string" &&
    typeof credential.accessToken === "string" &&
    typeof credential.refreshToken === "string" &&
    typeof credential.accessTokenExpiresAt === "string" &&
    Array.isArray(credential.scopes) &&
    credential.scopes.length === SPOTIFY_OAUTH_SCOPES.length &&
    SPOTIFY_OAUTH_SCOPES.every((scope) => credential.scopes?.includes(scope))
  );
}

export function shouldRefreshSpotifyToken(
  credential: SpotifyOAuthCredential,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(credential.accessTokenExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - now <= TOKEN_REFRESH_SKEW_MS;
}

export async function refreshSpotifyOAuthCredential(
  credential: SpotifyOAuthCredential,
  now = Date.now(),
): Promise<SpotifyOAuthCredential> {
  const body = await requestTokens(
    { clientId: credential.clientId, clientSecret: credential.clientSecret },
    new URLSearchParams({ refresh_token: credential.refreshToken }),
    "refresh_token",
  );
  const { accessToken, expiresIn } = requiredTokenFields(body);
  requiredScopes(body.scope, true);
  const refreshToken =
    body.refresh_token === undefined
      ? credential.refreshToken
      : normalizeOAuthToken(body.refresh_token);
  if (!refreshToken) {
    throw new ConnectorFetchError(
      "Spotify returned an unexpected authorization response.",
      { code: "oauth_token_response_invalid" },
    );
  }
  return {
    ...credential,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: tokenExpiry(expiresIn, now),
    scopes: ["user-top-read", "user-read-private"],
  };
}
