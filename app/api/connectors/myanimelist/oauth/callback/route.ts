import {
  chatGPTSignInPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  completeMyAnimeListOAuth,
  stageMyAnimeListOAuthCallback,
} from "@/lib/server/connectors";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

type CallbackResult =
  | "connected"
  | "denied"
  | "expired"
  | "invalid_state"
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

function studioRedirect(request: Request, result: CallbackResult): Response {
  const target = new URL("/studio", request.url);
  target.searchParams.set("connector", "myanimelist");
  target.searchParams.set("result", result);
  return redirectResponse(target);
}

async function finishOwnerBoundCallback(
  request: Request,
  resumeState: string,
): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) {
    const returnTo =
      `/api/connectors/myanimelist/oauth/callback` +
      `?resume=${encodeURIComponent(resumeState)}`;
    return redirectResponse(
      new URL(chatGPTSignInPath(returnTo), request.url),
      302,
    );
  }

  const owner = ownerAuthorizationForEmail(user.email);
  if (owner.status !== "allowed") {
    return studioRedirect(
      request,
      owner.status === "forbidden" ? "forbidden" : "setup_required",
    );
  }

  const result = await completeMyAnimeListOAuth({
    resumeState,
    actorEmail: user.email,
    requestUrl: request.url,
  });
  return studioRedirect(request, result.status);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resumeState = url.searchParams.get("resume");
  if (resumeState) {
    return finishOwnerBoundCallback(request, resumeState);
  }

  const state = url.searchParams.get("state") ?? "";
  const authorizationCode = url.searchParams.get("code") ?? undefined;
  const providerError = url.searchParams.get("error") ?? undefined;
  const staged = await stageMyAnimeListOAuthCallback({
    state,
    authorizationCode,
    providerError,
    requestUrl: request.url,
  });
  if (staged.status !== "ready") {
    return studioRedirect(request, staged.status);
  }

  return finishOwnerBoundCallback(request, staged.resumeState);
}
