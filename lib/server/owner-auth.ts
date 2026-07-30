import {
  getChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import { runtimeValue } from "./runtime-env";
import {
  evaluateOwnerAuthorization,
  parseOwnerEmails,
  type OwnerAuthorization,
} from "./owner-policy";

export { parseOwnerEmails, type OwnerAuthorization };

export function ownerAuthorizationForEmail(
  email: string,
  rawOwnerEmails = runtimeValue("OWNER_EMAILS"),
): OwnerAuthorization {
  return evaluateOwnerAuthorization(email, rawOwnerEmails);
}

export type OwnerApiAuthorization =
  | { ok: true; user: ChatGPTUser }
  | { ok: false; response: Response };

export async function authorizeOwnerApi(): Promise<OwnerApiAuthorization> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json(
        { error: "Sign in with ChatGPT to continue." },
        { status: 401 },
      ),
    };
  }

  const authorization = ownerAuthorizationForEmail(user.email);
  if (authorization.status === "setup_required") {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            "Owner access is not configured. Add OWNER_EMAILS before using Studio APIs.",
          code: "owner_setup_required",
        },
        { status: 503 },
      ),
    };
  }

  if (authorization.status === "forbidden") {
    return {
      ok: false,
      response: Response.json(
        { error: "This account is not permitted to manage the site." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}

export function rejectCrossOriginWrite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return Response.json(
      { error: "Cross-origin writes are not allowed." },
      { status: 403 },
    );
  }

  if (origin && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: "Cross-origin writes are not allowed." },
      { status: 403 },
    );
  }

  return null;
}
