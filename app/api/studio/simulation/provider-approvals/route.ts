import {
  disableSimulationProviderApproval,
  listSimulationProviderApprovals,
  upsertSimulationProviderApproval,
  validateSimulationProviderApproval,
} from "@/lib/server/simulation/approvals";
import type { PlayProvider } from "@/lib/server/simulation/contracts";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
} as const;
const PROVIDERS = new Set<PlayProvider>([
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
  "strava",
]);

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  try {
    return Response.json(
      { approvals: await listSimulationProviderApprovals() },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return Response.json(
      {
        error: "Simulation provider approvals are temporarily unavailable.",
        code: "simulation_approvals_unavailable",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function PUT(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const parsed = await readBoundedJsonBody(request, { maxBytes: 2_048 });
  if (!parsed.ok) return parsed.response;
  const approval = validateSimulationProviderApproval(parsed.value);
  if (!approval) {
    return Response.json(
      {
        error: "The provider approval is malformed.",
        code: "simulation_approval_invalid",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    await upsertSimulationProviderApproval(approval);
    return Response.json({ approval }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json(
      {
        error: "The provider approval could not be saved.",
        code: "simulation_approval_unavailable",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function DELETE(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const parsed = await readBoundedJsonBody(request, { maxBytes: 512 });
  if (!parsed.ok) return parsed.response;
  const value = parsed.value;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "provider") ||
    !PROVIDERS.has((value as { provider?: PlayProvider }).provider as PlayProvider)
  ) {
    return Response.json(
      {
        error: "Choose one supported provider.",
        code: "simulation_provider_invalid",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const provider = (value as { provider: PlayProvider }).provider;
  try {
    await disableSimulationProviderApproval(provider);
    return Response.json(
      { provider, enabled: false },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return Response.json(
      {
        error: "The provider approval could not be disabled.",
        code: "simulation_approval_unavailable",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
