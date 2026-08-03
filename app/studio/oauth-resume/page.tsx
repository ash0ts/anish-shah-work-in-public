import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import {
  completeDiscogsOAuth,
  completeMyAnimeListOAuth,
  completeSpotifyOAuth,
} from "@/lib/server/connectors";
import {
  discogsOAuthBrowserNonceFromRequest,
  isValidDiscogsOAuthOpaqueValue,
  resolveDiscogsCallbackUrl,
} from "@/lib/server/connectors/discogs-oauth";
import {
  isValidMyAnimeListOAuthState,
  MYANIMELIST_CALLBACK_PATH,
} from "@/lib/server/connectors/myanimelist-oauth";
import {
  isValidSpotifyOAuthState,
  resolveSpotifyCallbackUrl,
} from "@/lib/server/connectors/spotify-oauth";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { runtimeValue } from "@/lib/server/runtime-env";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resume provider authorization · Anish Shah",
  robots: { index: false, follow: false },
};

export default async function OAuthResumePage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; resume?: string }>;
}) {
  const query = await searchParams;
  if (
    query.provider !== "myanimelist" &&
    query.provider !== "spotify" &&
    query.provider !== "discogs"
  ) {
    redirect("/studio?result=invalid_state");
  }
  const provider = query.provider;
  const resumeState = query.resume ?? "";
  const returnTo =
    `/studio/oauth-resume?provider=${provider}` +
    `&resume=${encodeURIComponent(resumeState)}`;
  const user = await requireChatGPTUser(returnTo);

  const validState =
    provider === "spotify"
      ? isValidSpotifyOAuthState(resumeState)
      : provider === "discogs"
        ? isValidDiscogsOAuthOpaqueValue(resumeState)
        : isValidMyAnimeListOAuthState(resumeState);
  if (!validState) {
    redirect(`/studio?connector=${provider}&result=invalid_state`);
  }

  const owner = ownerAuthorizationForEmail(user.email);
  if (owner.status !== "allowed") {
    redirect(
      `/studio?connector=${provider}&result=${owner.status === "forbidden" ? "forbidden" : "setup_required"}`,
    );
  }

  let callbackUrl: string;
  try {
    const siteUrl = runtimeValue("SITE_URL");
    const resolved =
      provider === "spotify"
        ? resolveSpotifyCallbackUrl(
            siteUrl ?? "",
            siteUrl,
            runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
          )
        : provider === "discogs"
          ? resolveDiscogsCallbackUrl(
              siteUrl ?? "",
              siteUrl,
              runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
            )
          : new URL(MYANIMELIST_CALLBACK_PATH, siteUrl).toString();
    if (!resolved) throw new Error("Callback URL is not configured.");
    callbackUrl = resolved;
  } catch {
    redirect(`/studio?connector=${provider}&result=setup_required`);
  }

  const result =
    provider === "spotify"
      ? await completeSpotifyOAuth({
          resumeState,
          actorEmail: user.email,
          requestUrl: callbackUrl,
        })
      : provider === "discogs"
        ? await completeDiscogsOAuth({
            resumeState,
            actorEmail: user.email,
            browserNonce:
              discogsOAuthBrowserNonceFromRequest(
                new Request(callbackUrl, { headers: await headers() }),
              ) ?? "",
            requestUrl: callbackUrl,
          })
        : await completeMyAnimeListOAuth({
            resumeState,
            actorEmail: user.email,
            requestUrl: callbackUrl,
          });
  redirect(`/studio?connector=${provider}&result=${result.status}`);
}
