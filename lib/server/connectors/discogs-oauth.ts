import {
  ConnectorFetchError,
  type DiscogsOAuthCredential,
} from "./types";

export const DISCOGS_REQUEST_TOKEN_ENDPOINT =
  "https://api.discogs.com/oauth/request_token";
export const DISCOGS_AUTHORIZATION_ENDPOINT =
  "https://www.discogs.com/oauth/authorize";
export const DISCOGS_ACCESS_TOKEN_ENDPOINT =
  "https://api.discogs.com/oauth/access_token";
export const DISCOGS_CALLBACK_PATH =
  "/api/connectors/discogs/oauth/callback";
export const DISCOGS_PRODUCTION_ORIGIN = "https://anish-shah-is.online";
export const DISCOGS_STAGING_ORIGIN =
  "https://staging.anish-shah-is.online";
export const DISCOGS_LOCAL_STUDIO_ORIGIN = "http://localhost:3000";
export const DISCOGS_LOCAL_CALLBACK_ORIGIN = "http://127.0.0.1:3000";
export const DISCOGS_OAUTH_BROWSER_COOKIE = "anish_discogs_oauth_browser";
export const DISCOGS_USER_AGENT =
  "AnishShahWorkInPublic/1.0 (+https://anish-shah-is.online)";

const OAUTH_TIMEOUT_MS = 25_000;
const MAX_OAUTH_RESPONSE_BYTES = 32 * 1024;
const RANDOM_VALUE_BYTES = 32;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const OAUTH_VALUE = /^[^\s\u0000-\u001f\u007f]{1,8192}$/;

export type DiscogsOAuthClient = {
  consumerKey: string;
  consumerSecret: string;
};

export type DiscogsTemporaryCredential = {
  requestToken: string;
  requestTokenSecret: string;
};

export type DiscogsOAuthTransactionPayload = DiscogsOAuthClient &
  DiscogsTemporaryCredential & {
    phase: "authorization" | "callback";
    replaceExisting: boolean;
    callbackUrl: string;
    ownerEmail: string;
    stateHash: string;
    browserNonceHash: string;
    oauthVerifier?: string;
    denied?: true;
  };

type OAuthParameter = readonly [string, string];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(byteLength)),
  );
}

export function discogsPercentEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizedClientValue(
  value: string,
  maximumLength: number,
): string | null {
  const candidate = value.trim();
  if (
    candidate.length < 8 ||
    candidate.length > maximumLength ||
    CONTROL_CHARACTER.test(candidate) ||
    /\s/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function normalizedOAuthValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return OAUTH_VALUE.test(candidate) ? candidate : null;
}

export function isValidDiscogsOAuthToken(value: string): boolean {
  return normalizedOAuthValue(value) !== null;
}

export function normalizeDiscogsOAuthClient(
  consumerKey: string,
  consumerSecret: string,
): DiscogsOAuthClient | null {
  const normalizedConsumerKey = normalizedClientValue(consumerKey, 256);
  const normalizedConsumerSecret = normalizedClientValue(
    consumerSecret,
    2048,
  );
  return normalizedConsumerKey && normalizedConsumerSecret
    ? {
        consumerKey: normalizedConsumerKey,
        consumerSecret: normalizedConsumerSecret,
      }
    : null;
}

export function isDiscogsOAuthCredential(
  value: unknown,
): value is DiscogsOAuthCredential {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const credential = value as Partial<DiscogsOAuthCredential>;
  return (
    credential.kind === "oauth1" &&
    normalizeDiscogsOAuthClient(
      credential.consumerKey ?? "",
      credential.consumerSecret ?? "",
    ) !== null &&
    normalizedOAuthValue(credential.accessToken) !== null &&
    normalizedOAuthValue(credential.accessTokenSecret) !== null
  );
}

export function createDiscogsOAuthNonce(): string {
  return randomBase64Url(RANDOM_VALUE_BYTES);
}

export function createDiscogsOAuthBrowserNonce(): string {
  return randomBase64Url(RANDOM_VALUE_BYTES);
}

export function isValidDiscogsOAuthOpaqueValue(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export async function hashDiscogsOAuthValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function normalizedTimestamp(value: number | undefined): string {
  const timestamp = value ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError("OAuth timestamp must be a positive integer.");
  }
  return String(timestamp);
}

function normalizedNonce(value: string | undefined): string {
  const nonce = value ?? createDiscogsOAuthNonce();
  if (
    nonce.length < 8 ||
    nonce.length > 256 ||
    CONTROL_CHARACTER.test(nonce)
  ) {
    throw new TypeError("OAuth nonce is invalid.");
  }
  return nonce;
}

function oauthBaseUri(url: URL): string {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError("OAuth request URL is invalid.");
  }
  const defaultPort =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80");
  const authority = `${url.hostname.toLowerCase()}${url.port && !defaultPort ? `:${url.port}` : ""}`;
  return `${url.protocol.toLowerCase()}//${authority}${url.pathname || "/"}`;
}

function normalizedParameters(parameters: OAuthParameter[]): string {
  return parameters
    .map(
      ([name, value]) =>
        [discogsPercentEncode(name), discogsPercentEncode(value)] as const,
    )
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    })
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

async function hmacSha1(
  value: string,
  consumerSecret: string,
  tokenSecret: string,
): Promise<string> {
  const signingKey = `${discogsPercentEncode(consumerSecret)}&${discogsPercentEncode(tokenSecret)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64(new Uint8Array(signature));
}

async function oauthAuthorizationHeader(input: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
  bodyParameters?: URLSearchParams;
  nonce?: string;
  timestamp?: number;
  includeVersion?: boolean;
}): Promise<string> {
  const client = normalizeDiscogsOAuthClient(
    input.consumerKey,
    input.consumerSecret,
  );
  if (!client) throw new TypeError("Discogs OAuth client is invalid.");
  const url = new URL(input.url);
  const method = input.method.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method) || url.hash) {
    throw new TypeError("OAuth request target is invalid.");
  }

  const oauthParameters: OAuthParameter[] = [
    ["oauth_consumer_key", client.consumerKey],
    ["oauth_nonce", normalizedNonce(input.nonce)],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", normalizedTimestamp(input.timestamp)],
  ];
  if (input.includeVersion !== false) {
    oauthParameters.push(["oauth_version", "1.0"]);
  }
  if (input.token !== undefined) {
    const token = normalizedOAuthValue(input.token);
    if (!token) throw new TypeError("Discogs OAuth token is invalid.");
    oauthParameters.push(["oauth_token", token]);
  }
  if (input.callback !== undefined) {
    const callback = new URL(input.callback);
    if (
      !["http:", "https:"].includes(callback.protocol) ||
      callback.username ||
      callback.password ||
      callback.hash
    ) {
      throw new TypeError("Discogs OAuth callback is invalid.");
    }
    oauthParameters.push(["oauth_callback", callback.toString()]);
  }
  if (input.verifier !== undefined) {
    const verifier = normalizedOAuthValue(input.verifier);
    if (!verifier) throw new TypeError("Discogs OAuth verifier is invalid.");
    oauthParameters.push(["oauth_verifier", verifier]);
  }

  const requestParameters: OAuthParameter[] = [
    ...url.searchParams.entries(),
    ...(input.bodyParameters?.entries() ?? []),
  ];
  if (requestParameters.some(([name]) => name.startsWith("oauth_"))) {
    throw new TypeError(
      "OAuth protocol parameters must be supplied by the signer.",
    );
  }
  const signatureParameters: OAuthParameter[] = [
    ...requestParameters,
    ...oauthParameters,
  ];
  const signatureBaseString = [
    method,
    discogsPercentEncode(oauthBaseUri(url)),
    discogsPercentEncode(normalizedParameters(signatureParameters)),
  ].join("&");
  const signature = await hmacSha1(
    signatureBaseString,
    client.consumerSecret,
    input.tokenSecret ?? "",
  );
  const headerParameters = [
    ...oauthParameters,
    ["oauth_signature", signature] as const,
  ].sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1));
  return `OAuth ${headerParameters
    .map(
      ([name, value]) =>
        `${discogsPercentEncode(name)}="${discogsPercentEncode(value)}"`,
    )
    .join(", ")}`;
}

/**
 * Discogs documents PLAINTEXT signatures for its OAuth token endpoints. Keep
 * this provider-specific signer isolated from authenticated catalog requests,
 * which continue to use RFC 5849 HMAC-SHA1 through
 * buildDiscogsAuthorizationHeader(). The credential-bearing header is sent
 * only to the fixed HTTPS Discogs token endpoints and is never logged.
 */
function discogsTokenAuthorizationHeader(input: {
  client: DiscogsOAuthClient;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
  nonce?: string;
  timestamp?: number;
}): string {
  const client = normalizeDiscogsOAuthClient(
    input.client.consumerKey,
    input.client.consumerSecret,
  );
  if (!client) throw new TypeError("Discogs OAuth client is invalid.");

  const parameters: OAuthParameter[] = [
    ["oauth_consumer_key", client.consumerKey],
    ["oauth_nonce", normalizedNonce(input.nonce)],
    ["oauth_signature_method", "PLAINTEXT"],
    ["oauth_timestamp", normalizedTimestamp(input.timestamp)],
  ];
  if (input.token !== undefined) {
    const token = normalizedOAuthValue(input.token);
    if (!token) throw new TypeError("Discogs OAuth token is invalid.");
    parameters.push(["oauth_token", token]);
  }
  if (input.callback !== undefined) {
    const callback = new URL(input.callback);
    if (
      !["http:", "https:"].includes(callback.protocol) ||
      callback.username ||
      callback.password ||
      callback.hash
    ) {
      throw new TypeError("Discogs OAuth callback is invalid.");
    }
    parameters.push(["oauth_callback", callback.toString()]);
  }
  if (input.verifier !== undefined) {
    const verifier = normalizedOAuthValue(input.verifier);
    if (!verifier) throw new TypeError("Discogs OAuth verifier is invalid.");
    parameters.push(["oauth_verifier", verifier]);
  }

  const tokenSecret = input.tokenSecret ?? "";
  if (tokenSecret && !normalizedOAuthValue(tokenSecret)) {
    throw new TypeError("Discogs OAuth token secret is invalid.");
  }
  parameters.push([
    "oauth_signature",
    `${discogsPercentEncode(client.consumerSecret)}&${discogsPercentEncode(tokenSecret)}`,
  ]);

  return `OAuth ${parameters
    .sort(([left], [right]) =>
      left === right ? 0 : left < right ? -1 : 1,
    )
    .map(
      ([name, value]) =>
        `${discogsPercentEncode(name)}="${discogsPercentEncode(value)}"`,
    )
    .join(", ")}`;
}

/**
 * Signs an authenticated Discogs API request without exposing token material
 * in the request URL. Optional nonce/timestamp inputs exist for deterministic
 * RFC 5849 tests; production callers should omit them.
 */
export function buildDiscogsAuthorizationHeader(input: {
  method: string;
  url: string;
  credential: DiscogsOAuthCredential;
  bodyParameters?: URLSearchParams;
  nonce?: string;
  timestamp?: number;
  includeVersion?: boolean;
}): Promise<string> {
  if (!isDiscogsOAuthCredential(input.credential)) {
    throw new TypeError("Discogs OAuth credential is invalid.");
  }
  return oauthAuthorizationHeader({
    method: input.method,
    url: input.url,
    consumerKey: input.credential.consumerKey,
    consumerSecret: input.credential.consumerSecret,
    token: input.credential.accessToken,
    tokenSecret: input.credential.accessTokenSecret,
    bodyParameters: input.bodyParameters,
    nonce: input.nonce,
    timestamp: input.timestamp,
    includeVersion: input.includeVersion,
  });
}

export function resolveDiscogsCallbackUrl(
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
      site.origin !== DISCOGS_LOCAL_STUDIO_ORIGIN ||
      ![
        DISCOGS_LOCAL_STUDIO_ORIGIN,
        DISCOGS_LOCAL_CALLBACK_ORIGIN,
      ].includes(request.origin)
    ) {
      return null;
    }
    return `${DISCOGS_LOCAL_CALLBACK_ORIGIN}${DISCOGS_CALLBACK_PATH}`;
  }
  if (
    ![DISCOGS_PRODUCTION_ORIGIN, DISCOGS_STAGING_ORIGIN].includes(
      site.origin,
    ) ||
    request.origin !== site.origin
  ) {
    return null;
  }
  return `${site.origin}${DISCOGS_CALLBACK_PATH}`;
}

export function isDiscogsLocalCallbackBridgeRequest(
  requestUrl: string,
  configuredSiteUrl: string | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  if (nodeEnvironment !== "development") return false;
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return false;
  }
  return (
    request.origin === DISCOGS_LOCAL_CALLBACK_ORIGIN &&
    request.pathname === DISCOGS_CALLBACK_PATH &&
    resolveDiscogsCallbackUrl(
      requestUrl,
      configuredSiteUrl,
      nodeEnvironment,
    ) === `${DISCOGS_LOCAL_CALLBACK_ORIGIN}${DISCOGS_CALLBACK_PATH}`
  );
}

export function buildDiscogsAuthorizationUrl(requestToken: string): string {
  const token = normalizedOAuthValue(requestToken);
  if (!token) throw new TypeError("Discogs request token is invalid.");
  const url = new URL(DISCOGS_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("oauth_token", token);
  return url.toString();
}

function invalidOAuthResponse(): ConnectorFetchError {
  return new ConnectorFetchError(
    "Discogs returned an unexpected authorization response.",
    { code: "oauth_token_response_invalid" },
  );
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_OAUTH_RESPONSE_BYTES)
  ) {
    throw invalidOAuthResponse();
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
      if (total > MAX_OAUTH_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidOAuthResponse();
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
    throw invalidOAuthResponse();
  }
}

function responseParameter(
  parameters: URLSearchParams,
  name: string,
): string {
  const values = parameters.getAll(name);
  const value = values.length === 1 ? normalizedOAuthValue(values[0]) : null;
  if (!value) throw invalidOAuthResponse();
  return value;
}

async function oauthFailure(
  response: Response,
  phase: "request_token" | "access_token",
): Promise<ConnectorFetchError> {
  if (response.status === 401) {
    return new ConnectorFetchError(
      phase === "request_token"
        ? "Discogs rejected the consumer credentials."
        : "Discogs authorization needs to be renewed.",
      {
        code:
          phase === "request_token"
            ? "credential_invalid"
            : "reauthorization_required",
        httpStatus: 401,
      },
    );
  }
  return new ConnectorFetchError(
    phase === "request_token"
      ? "Discogs could not start authorization."
      : "Discogs could not complete authorization.",
    {
      code:
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_error"
            : "oauth_exchange_failed",
      httpStatus: response.status,
      retryable: response.status === 429 || response.status >= 500,
    },
  );
}

type DiscogsOAuthTokenRequest = {
  client: DiscogsOAuthClient;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
  phase: "request_token" | "access_token";
};

async function oauthTokenAttempt(
  input: DiscogsOAuthTokenRequest,
): Promise<URLSearchParams> {
  const endpoint =
    input.phase === "request_token"
      ? DISCOGS_REQUEST_TOKEN_ENDPOINT
      : DISCOGS_ACCESS_TOKEN_ENDPOINT;
  const method = input.phase === "request_token" ? "GET" : "POST";
  const authorization = discogsTokenAuthorizationHeader({
    client: input.client,
    token: input.token,
    tokenSecret: input.tokenSecret,
    callback: input.callback,
    verifier: input.verifier,
  });
  const headers: Record<string, string> = {
    Accept: "application/x-www-form-urlencoded, text/plain",
    Authorization: authorization,
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": DISCOGS_USER_AGENT,
  };
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), OAUTH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method,
      cache: "no-store",
      redirect: "manual",
      signal: abortController.signal,
      headers,
      ...(method === "POST" ? { body: "" } : {}),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ConnectorFetchError(
        "Discogs returned an unexpected authorization redirect.",
        {
          code: "provider_redirect",
          httpStatus: response.status,
        },
      );
    }
    if (!response.ok) throw await oauthFailure(response, input.phase);
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      mediaType !== "application/x-www-form-urlencoded" &&
      mediaType !== "text/plain"
    ) {
      throw invalidOAuthResponse();
    }
    return new URLSearchParams(await boundedResponseText(response));
  } catch (error) {
    if (error instanceof ConnectorFetchError) throw error;
    throw new ConnectorFetchError(
      "Discogs authorization is temporarily unavailable.",
      {
        code: abortController.signal.aborted
          ? "provider_timeout"
          : "provider_transport",
        retryable: true,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryRequestToken(error: unknown): boolean {
  return (
    error instanceof ConnectorFetchError &&
    (error.code === "provider_transport" ||
      (error.code === "provider_error" &&
        error.httpStatus !== null &&
        [502, 503, 504].includes(error.httpStatus)))
  );
}

async function oauthTokenRequest(
  input: DiscogsOAuthTokenRequest,
): Promise<URLSearchParams> {
  try {
    return await oauthTokenAttempt(input);
  } catch (error) {
    if (
      input.phase !== "request_token" ||
      !shouldRetryRequestToken(error)
    ) {
      throw error;
    }
  }
  return oauthTokenAttempt(input);
}

export async function requestDiscogsTemporaryCredential(
  client: DiscogsOAuthClient,
  callbackUrl: string,
): Promise<DiscogsTemporaryCredential> {
  const parameters = await oauthTokenRequest({
    client,
    callback: callbackUrl,
    phase: "request_token",
  });
  if (
    parameters.getAll("oauth_callback_confirmed").length !== 1 ||
    parameters.get("oauth_callback_confirmed") !== "true"
  ) {
    throw invalidOAuthResponse();
  }
  return {
    requestToken: responseParameter(parameters, "oauth_token"),
    requestTokenSecret: responseParameter(parameters, "oauth_token_secret"),
  };
}

export async function exchangeDiscogsAccessToken(input: {
  client: DiscogsOAuthClient;
  requestToken: string;
  requestTokenSecret: string;
  oauthVerifier: string;
}): Promise<DiscogsOAuthCredential> {
  const parameters = await oauthTokenRequest({
    client: input.client,
    token: input.requestToken,
    tokenSecret: input.requestTokenSecret,
    verifier: input.oauthVerifier,
    phase: "access_token",
  });
  return {
    kind: "oauth1",
    consumerKey: input.client.consumerKey,
    consumerSecret: input.client.consumerSecret,
    accessToken: responseParameter(parameters, "oauth_token"),
    accessTokenSecret: responseParameter(
      parameters,
      "oauth_token_secret",
    ),
  };
}

function cookieSecureAttribute(requestUrl: string): string {
  try {
    return new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  } catch {
    return "";
  }
}

export function discogsOAuthBrowserCookie(
  browserNonce: string,
  requestUrl: string,
): string {
  if (!isValidDiscogsOAuthOpaqueValue(browserNonce)) {
    throw new TypeError("Discogs OAuth browser nonce is invalid.");
  }
  return `${DISCOGS_OAUTH_BROWSER_COOKIE}=${browserNonce}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${cookieSecureAttribute(requestUrl)}`;
}

export function clearDiscogsOAuthBrowserCookie(requestUrl: string): string {
  return `${DISCOGS_OAUTH_BROWSER_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${cookieSecureAttribute(requestUrl)}`;
}

export function discogsOAuthBrowserNonceFromRequest(
  request: Request,
): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...pieces] = part.trim().split("=");
    if (name !== DISCOGS_OAUTH_BROWSER_COOKIE) continue;
    const value = pieces.join("=");
    return isValidDiscogsOAuthOpaqueValue(value) ? value : null;
  }
  return null;
}
