import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { completeMyAnimeListOAuth } from "@/lib/server/connectors";
import {
  isValidMyAnimeListOAuthState,
  MYANIMELIST_CALLBACK_PATH,
} from "@/lib/server/connectors/myanimelist-oauth";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { runtimeValue } from "@/lib/server/runtime-env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resume MyAnimeList authorization · Anish Shah",
  robots: { index: false, follow: false },
};

export default async function MyAnimeListOAuthResumePage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const query = await searchParams;
  const resumeState = query.resume ?? "";
  const returnTo = `/studio/oauth-resume?resume=${encodeURIComponent(resumeState)}`;
  const user = await requireChatGPTUser(returnTo);

  if (!isValidMyAnimeListOAuthState(resumeState)) {
    redirect("/studio?connector=myanimelist&result=invalid_state");
  }

  const owner = ownerAuthorizationForEmail(user.email);
  if (owner.status !== "allowed") {
    redirect(
      `/studio?connector=myanimelist&result=${owner.status === "forbidden" ? "forbidden" : "setup_required"}`,
    );
  }

  let callbackUrl: string;
  try {
    callbackUrl = new URL(
      MYANIMELIST_CALLBACK_PATH,
      runtimeValue("SITE_URL"),
    ).toString();
  } catch {
    redirect("/studio?connector=myanimelist&result=setup_required");
  }

  const result = await completeMyAnimeListOAuth({
    resumeState,
    actorEmail: user.email,
    requestUrl: callbackUrl,
  });
  redirect(`/studio?connector=myanimelist&result=${result.status}`);
}
