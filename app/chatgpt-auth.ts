import { headers } from "next/headers.js";
import { redirect } from "next/navigation.js";

export type ChatGPTUser = {
  authSource: "chatgpt" | "local-development";
  displayName: string;
  email: string;
  fullName: string | null;
};

type HeaderReader = Pick<Headers, "get">;

type LocalDevelopmentAuthEnvironment = {
  LOCAL_OWNER_EMAIL?: string;
  NODE_ENV?: string;
  OWNER_EMAILS?: string;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) {
    return resolveLocalDevelopmentUser(requestHeaders);
  }

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    authSource: "chatgpt",
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

/**
 * Local Studio access is deliberately narrower than hosted authentication:
 * it is available only in development, on an exact loopback Host, and when
 * the explicitly configured local identity is also on the owner allowlist.
 *
 * This helper is exported so the security boundary can be tested without
 * mocking Next's request-scoped `headers()` implementation.
 */
export function resolveLocalDevelopmentUser(
  requestHeaders: HeaderReader,
  environment: LocalDevelopmentAuthEnvironment = process.env,
): ChatGPTUser | null {
  if (environment.NODE_ENV !== "development") return null;

  const host = requestHeaders.get("host");
  if (!host || !isLoopbackHost(host)) return null;

  const localEmail = environment.LOCAL_OWNER_EMAIL?.trim();
  if (!localEmail || !isAllowlistedOwner(localEmail, environment.OWNER_EMAILS)) {
    return null;
  }

  return {
    authSource: "local-development",
    displayName: localEmail,
    email: localEmail,
    fullName: null,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  if (host !== host.trim()) return false;

  const match =
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host);
  if (!match) return false;

  if (!match[1]) return true;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function isAllowlistedOwner(
  email: string,
  rawOwnerEmails: string | undefined,
): boolean {
  const normalizedEmail = email.toLocaleLowerCase();
  return (
    rawOwnerEmails
      ?.split(",")
      .map((candidate) => candidate.trim().toLocaleLowerCase())
      .filter(Boolean)
      .includes(normalizedEmail) ?? false
  );
}
