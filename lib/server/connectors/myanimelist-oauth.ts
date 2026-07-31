import {
  ConnectorFetchError,
  type MyAnimeListOAuthCredential,
} from "./types";

export const MYANIMELIST_AUTHORIZATION_ENDPOINT =
  "https://myanimelist.net/v1/oauth2/authorize";
export const MYANIMELIST_TOKEN_ENDPOINT =
  "https://myanimelist.net/v1/oauth2/token";
export const MYANIMELIST_CALLBACK_PATH =
  "/api/connectors/myanimelist/oauth/callback";

const OAUTH_TIMEOUT_MS = 25_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const RANDOM_STATE_BYTES = 32;
const PKCE_VERIFIER_BYTES = 64;

type TokenResponse = {
  token_type?: unknown;
  expires_in?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
};

type OAuthErrorResponse = {
  error?: unknown;
};

export type MyAnimeListOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export type MyAnimeListOAuthTransactionPayload = MyAnimeListOAuthClient & {
  phase: "authorization" | "callback";
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

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeOAuthToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > 8192 ||
    hasControlCharacters(candidate) ||
    /\s/.test(candidate)
  ) {
    return "";
  }
  return candidate;
}

function normalizeClientValue(
  value: string,
  maximumLength: number,
): string | null {
  const candidate = value.trim();
  if (
    candidate.length < 8 ||
    candidate.length > maximumLength ||
    hasControlCharacters(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function normalizeMyAnimeListOAuthClient(
  clientId: string,
  clientSecret: string,
): MyAnimeListOAuthClient | null {
  const normalizedClientId = normalizeClientValue(clientId, 256);
  const normalizedClientSecret = normalizeClientValue(clientSecret, 2048);
  if (!normalizedClientId || !normalizedClientSecret) return null;
  return {
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
  };
}

export function createMyAnimeListOAuthState(): string {
  return randomBase64Url(RANDOM_STATE_BYTES);
}

/**
 * MyAnimeList requires the plain PKCE method. This verifier is both the
 * code_verifier sent to the token endpoint and the code_challenge sent to the
 * authorization endpoint.
 */
export function createMyAnimeListPkceVerifier(): string {
  return randomBase64Url(PKCE_VERIFIER_BYTES);
}

export async function hashMyAnimeListOAuthState(
  state: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function isValidMyAnimeListOAuthState(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function buildMyAnimeListAuthorizationUrl(input: {
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(MYANIMELIST_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeVerifier);
  url.searchParams.set("code_challenge_method", "plain");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function resolveMyAnimeListCallbackUrl(
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
    site.hash ||
    request.origin !== site.origin
  ) {
    return null;
  }

  if (nodeEnvironment === "development") {
    if (site.origin !== "http://localhost:3000") return null;
  } else if (site.protocol !== "https:") {
    return null;
  }

  return new URL(MYANIMELIST_CALLBACK_PATH, site).toString();
}

function safeOAuthProviderError(body: unknown): string | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("error" in body) ||
    typeof (body as OAuthErrorResponse).error !== "string"
  ) {
    return null;
  }
  const candidate = (body as { error: string }).error;
  return /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate : null;
}

async function tokenFailureCode(
  response: Response,
  grant: "authorization_code" | "refresh_token",
): Promise<ConnectorFetchError> {
  let providerError: string | null = null;
  try {
    providerError = safeOAuthProviderError(await response.json());
  } catch {
    // Provider response bodies are intentionally not retained or surfaced.
  }

  if (
    grant === "refresh_token" &&
    (response.status === 400 || response.status === 401) &&
    (providerError === "invalid_grant" ||
      providerError === "invalid_request" ||
      providerError === null)
  ) {
    return new ConnectorFetchError(
      "MyAnimeList authorization needs to be renewed.",
      {
        code: "reauthorization_required",
        httpStatus: response.status,
      },
    );
  }

  return new ConnectorFetchError(
    grant === "authorization_code"
      ? "MyAnimeList could not complete authorization."
      : "MyAnimeList could not refresh authorization.",
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
  client: MyAnimeListOAuthClient,
  parameters: URLSearchParams,
  grant: "authorization_code" | "refresh_token",
): Promise<TokenResponse> {
  parameters.set("client_id", client.clientId);
  parameters.set("client_secret", client.clientSecret);
  parameters.set("grant_type", grant);

  let response: Response;
  try {
    response = await fetch(MYANIMELIST_TOKEN_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: parameters.toString(),
    });
  } catch {
    throw new ConnectorFetchError(
      "MyAnimeList authorization is temporarily unavailable.",
      { code: "provider_error", retryable: true },
    );
  }

  if (!response.ok) throw await tokenFailureCode(response, grant);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected authorization response.",
      { code: "oauth_token_response_invalid" },
    );
  }
  if (typeof body !== "object" || body === null) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected authorization response.",
      { code: "oauth_token_response_invalid" },
    );
  }
  return body as TokenResponse;
}

function requiredTokenFields(body: TokenResponse): {
  accessToken: string;
  expiresIn: number;
} {
  const accessToken = normalizeOAuthToken(body.access_token);
  const expiresIn =
    typeof body.expires_in === "number"
      ? body.expires_in
      : Number(body.expires_in);
  if (
    !accessToken ||
    accessToken.length > 8192 ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 366 * 24 * 60 * 60
  ) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected authorization response.",
      { code: "oauth_token_response_invalid" },
    );
  }
  return { accessToken, expiresIn };
}

function tokenExpiry(expiresIn: number, now: number): string {
  return new Date(now + Math.floor(expiresIn * 1000)).toISOString();
}

export async function exchangeMyAnimeListAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  now?: number;
}): Promise<MyAnimeListOAuthCredential> {
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
  const refreshToken = normalizeOAuthToken(body.refresh_token);
  if (!refreshToken) {
    throw new ConnectorFetchError(
      "MyAnimeList did not return a renewable authorization.",
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
  };
}

export function isMyAnimeListOAuthCredential(
  value: unknown,
): value is MyAnimeListOAuthCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Partial<MyAnimeListOAuthCredential>;
  return (
    credential.kind === "oauth" &&
    typeof credential.clientId === "string" &&
    typeof credential.clientSecret === "string" &&
    typeof credential.accessToken === "string" &&
    typeof credential.refreshToken === "string" &&
    typeof credential.accessTokenExpiresAt === "string"
  );
}

export function shouldRefreshMyAnimeListToken(
  credential: MyAnimeListOAuthCredential,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(credential.accessTokenExpiresAt);
  return (
    !Number.isFinite(expiresAt) ||
    expiresAt - now <= TOKEN_REFRESH_SKEW_MS
  );
}

export async function refreshMyAnimeListOAuthCredential(
  credential: MyAnimeListOAuthCredential,
  now = Date.now(),
): Promise<MyAnimeListOAuthCredential> {
  const body = await requestTokens(
    {
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
    },
    new URLSearchParams({ refresh_token: credential.refreshToken }),
    "refresh_token",
  );
  const { accessToken, expiresIn } = requiredTokenFields(body);
  const rotatedRefreshToken =
    body.refresh_token === undefined
      ? credential.refreshToken
      : normalizeOAuthToken(body.refresh_token);
  if (!rotatedRefreshToken) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected authorization response.",
      { code: "oauth_token_response_invalid" },
    );
  }

  return {
    ...credential,
    accessToken,
    refreshToken: rotatedRefreshToken,
    accessTokenExpiresAt: tokenExpiry(expiresIn, now),
  };
}
