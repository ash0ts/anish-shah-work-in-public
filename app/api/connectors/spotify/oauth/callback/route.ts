import {
  chatGPTSignInPath,
  getChatGPTUser,
  localStudioSetupPath,
} from "@/app/chatgpt-auth";
import {
  completeSpotifyOAuth,
  stageSpotifyOAuthCallback,
} from "@/lib/server/connectors";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { runtimeValue } from "@/lib/server/runtime-env";

export const dynamic = "force-dynamic";

type CallbackResult =
  | "connected"
  | "denied"
  | "expired"
  | "invalid_state"
  | "provider_unavailable"
  | "rate_limited"
  | "token_exchange_failed"
  | "setup_required"
  | "forbidden";

function redirectResponse(target: URL, status = 303): Response {
  return new Response(null, {
    status,
    headers: {
      location: target.toString(),
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function configuredStudioOrigin(request: Request): URL | null {
  try {
    const requestUrl = new URL(request.url);
    const configured = new URL(runtimeValue("SITE_URL") ?? "");
    const environment =
      runtimeValue("NODE_ENV") ?? process.env.NODE_ENV;
    const localRequestOrigin = "http://127.0.0.1:3000";
    const safeConfiguredOrigin =
      environment === "development"
        ? configured.origin === "http://localhost:3000" ||
          configured.origin === localRequestOrigin
        : configured.protocol === "https:";
    const safeRequestOrigin =
      environment === "development"
        ? requestUrl.origin === configured.origin ||
          requestUrl.origin === localRequestOrigin
        : requestUrl.origin === configured.origin;
    if (
      !safeConfiguredOrigin ||
      !safeRequestOrigin ||
      configured.pathname !== "/" ||
      configured.search ||
      configured.hash ||
      configured.username ||
      configured.password
    ) {
      return null;
    }
    return configured;
  } catch {
    return null;
  }
}

function studioRedirect(request: Request, result: CallbackResult): Response {
  const site = configuredStudioOrigin(request);
  if (!site) {
    return new Response("OAuth callback origin is not configured.", {
      status: 400,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
        "referrer-policy": "no-referrer",
      },
    });
  }
  const target = new URL("/studio", site);
  target.searchParams.set("connector", "spotify");
  target.searchParams.set("result", result);
  return redirectResponse(target);
}

async function finishOwnerBoundCallback(
  request: Request,
  resumeState: string,
): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) {
    const site = configuredStudioOrigin(request);
    if (!site) return studioRedirect(request, "setup_required");
    const returnTo =
      `/api/connectors/spotify/oauth/callback` +
      `?resume=${encodeURIComponent(resumeState)}`;
    if (runtimeValue("AUTH_MODE") === "cloudflare_access") {
      const accessResume = new URL("/studio/oauth-resume", site);
      accessResume.searchParams.set("provider", "spotify");
      accessResume.searchParams.set("resume", resumeState);
      return redirectResponse(accessResume, 302);
    }
    const environment =
      runtimeValue("NODE_ENV") ?? process.env.NODE_ENV;
    const signInPath =
      environment === "development"
        ? localStudioSetupPath(returnTo)
        : chatGPTSignInPath(returnTo);
    return redirectResponse(new URL(signInPath, site), 302);
  }

  const owner = ownerAuthorizationForEmail(user.email);
  if (owner.status !== "allowed") {
    return studioRedirect(
      request,
      owner.status === "forbidden" ? "forbidden" : "setup_required",
    );
  }
  const result = await completeSpotifyOAuth({
    resumeState,
    actorEmail: user.email,
    requestUrl: request.url,
  });
  return studioRedirect(request, result.status);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resumeState = url.searchParams.get("resume");
  if (resumeState) return finishOwnerBoundCallback(request, resumeState);

  const staged = await stageSpotifyOAuthCallback({
    state: url.searchParams.get("state") ?? "",
    authorizationCode: url.searchParams.get("code") ?? undefined,
    providerError: url.searchParams.get("error") ?? undefined,
    requestUrl: request.url,
  });
  if (staged.status !== "ready") {
    return studioRedirect(request, staged.status);
  }
  return finishOwnerBoundCallback(request, staged.resumeState);
}
