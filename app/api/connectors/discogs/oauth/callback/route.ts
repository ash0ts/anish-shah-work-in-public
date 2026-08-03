import {
  chatGPTSignInPath,
  getChatGPTUser,
  localStudioSetupPath,
} from "@/app/chatgpt-auth";
import {
  completeDiscogsOAuth,
  stageDiscogsOAuthCallback,
} from "@/lib/server/connectors";
import {
  clearDiscogsOAuthBrowserCookie,
  discogsOAuthBrowserNonceFromRequest,
  DISCOGS_CALLBACK_PATH,
  isDiscogsLocalCallbackBridgeRequest,
  resolveDiscogsCallbackUrl,
} from "@/lib/server/connectors/discogs-oauth";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { runtimeValue } from "@/lib/server/runtime-env";

export const dynamic = "force-dynamic";

type CallbackResult =
  | "connected"
  | "denied"
  | "expired"
  | "invalid_state"
  | "reauthorization_required"
  | "provider_unavailable"
  | "rate_limited"
  | "token_exchange_failed"
  | "setup_required"
  | "forbidden";

function redirectResponse(
  target: URL,
  status = 303,
  clearBrowserCookie = false,
  requestUrl = target.toString(),
): Response {
  const headers = new Headers({
    location: target.toString(),
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  });
  if (clearBrowserCookie) {
    headers.set("set-cookie", clearDiscogsOAuthBrowserCookie(requestUrl));
  }
  return new Response(null, { status, headers });
}

function configuredStudioOrigin(request: Request): URL | null {
  const configured = runtimeValue("SITE_URL");
  const environment = runtimeValue("NODE_ENV") ?? process.env.NODE_ENV;
  const callback = resolveDiscogsCallbackUrl(
    request.url,
    configured,
    environment,
  );
  if (!callback) return null;
  try {
    return new URL(configured ?? "");
  } catch {
    return null;
  }
}

function studioRedirect(
  request: Request,
  result: CallbackResult,
  clearBrowserCookie = true,
): Response {
  const site = configuredStudioOrigin(request);
  if (!site) {
    return new Response("OAuth callback origin is not configured.", {
      status: 400,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
        "referrer-policy": "no-referrer",
        ...(clearBrowserCookie
          ? {
              "set-cookie": clearDiscogsOAuthBrowserCookie(request.url),
            }
          : {}),
      },
    });
  }
  const target = new URL("/studio", site);
  target.searchParams.set("connector", "discogs");
  target.searchParams.set("result", result);
  return redirectResponse(
    target,
    303,
    clearBrowserCookie,
    site.toString(),
  );
}

function localCallbackBridge(request: Request): boolean {
  return isDiscogsLocalCallbackBridgeRequest(
    request.url,
    runtimeValue("SITE_URL"),
    runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
  );
}

async function finishOwnerBoundCallback(
  request: Request,
  resumeState: string,
): Promise<Response> {
  const browserNonce = discogsOAuthBrowserNonceFromRequest(request);
  if (!browserNonce) return studioRedirect(request, "invalid_state");

  const user = await getChatGPTUser();
  if (!user) {
    const site = configuredStudioOrigin(request);
    if (!site) return studioRedirect(request, "setup_required");
    const returnTo =
      `/api/connectors/discogs/oauth/callback` +
      `?resume=${encodeURIComponent(resumeState)}`;
    if (runtimeValue("AUTH_MODE") === "cloudflare_access") {
      const accessResume = new URL("/studio/oauth-resume", site);
      accessResume.searchParams.set("provider", "discogs");
      accessResume.searchParams.set("resume", resumeState);
      return redirectResponse(accessResume, 302, false, request.url);
    }
    const environment = runtimeValue("NODE_ENV") ?? process.env.NODE_ENV;
    const signInPath =
      environment === "development"
        ? localStudioSetupPath(returnTo)
        : chatGPTSignInPath(returnTo);
    return redirectResponse(
      new URL(signInPath, site),
      302,
      false,
      request.url,
    );
  }

  const owner = ownerAuthorizationForEmail(user.email);
  if (owner.status !== "allowed") {
    return studioRedirect(
      request,
      owner.status === "forbidden" ? "forbidden" : "setup_required",
    );
  }
  const result = await completeDiscogsOAuth({
    resumeState,
    actorEmail: user.email,
    browserNonce,
    requestUrl: request.url,
  });
  return studioRedirect(request, result.status);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resumeState = url.searchParams.get("resume");
  if (resumeState) return finishOwnerBoundCallback(request, resumeState);

  const oauthToken = url.searchParams.get("oauth_token");
  const deniedToken = url.searchParams.get("denied");
  const conflictingTokens = Boolean(oauthToken && deniedToken);
  const browserNonce = discogsOAuthBrowserNonceFromRequest(request);
  const shouldBridgeToStudio = localCallbackBridge(request);
  if (conflictingTokens || (!browserNonce && !shouldBridgeToStudio)) {
    return studioRedirect(request, "invalid_state");
  }
  const requestToken = deniedToken ?? oauthToken ?? "";
  const staged = await stageDiscogsOAuthCallback({
    requestToken,
    ...(deniedToken
      ? { denied: true }
      : {
          oauthVerifier:
            url.searchParams.get("oauth_verifier") ?? undefined,
        }),
    ...(browserNonce ? { browserNonce } : {}),
    requestUrl: request.url,
  });
  if (staged.status !== "ready") {
    return studioRedirect(request, staged.status);
  }
  if (shouldBridgeToStudio) {
    const site = configuredStudioOrigin(request);
    if (!site) return studioRedirect(request, "setup_required");
    const resume = new URL(DISCOGS_CALLBACK_PATH, site);
    resume.searchParams.set("resume", staged.resumeState);
    return redirectResponse(resume, 303, false, request.url);
  }
  return finishOwnerBoundCallback(request, staged.resumeState);
}
