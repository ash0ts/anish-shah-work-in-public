import { rejectCrossOriginWrite } from "../owner-auth";
import { readBoundedJsonBody } from "../request-security";
import {
  endSimulationSession,
  readSimulationSession,
  SimulationServiceError,
  startSimulationSession,
  submitSimulationTurn,
} from "./service";
import {
  expiredSimulationSessionCookie,
  simulationSessionCookie,
} from "./session-crypto";
import {
  validateCreateSessionInput,
  validateSimulationTurnRequest,
} from "./validation";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
} as const;

function jsonError(error: unknown): Response {
  if (error instanceof SimulationServiceError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: PRIVATE_HEADERS },
    );
  }
  return Response.json(
    {
      error: "The simulation service is temporarily unavailable.",
      code: "simulation_unavailable",
    },
    { status: 503, headers: PRIVATE_HEADERS },
  );
}

export async function handleSimulationSessionGet(request: Request) {
  try {
    const session = await readSimulationSession(request);
    const response = Response.json(
      session ? { status: "ready", session } : { status: "none" },
      { headers: PRIVATE_HEADERS },
    );
    if (!session) {
      response.headers.append("set-cookie", expiredSimulationSessionCookie());
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleSimulationSessionPost(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const body = await readBoundedJsonBody(request, { maxBytes: 1_024 });
  if (!body.ok) return body.response;
  const validated = validateCreateSessionInput(body.value);
  if (!validated.ok) {
    return Response.json(
      { error: validated.message, code: validated.code },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const created = await startSimulationSession(request, validated.value);
    const response = Response.json(
      { status: "ready", session: created.session },
      { status: 201, headers: PRIVATE_HEADERS },
    );
    response.headers.append("set-cookie", simulationSessionCookie(created.token));
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleSimulationSessionDelete(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  try {
    await endSimulationSession(request);
    const response = Response.json(
      { status: "deleted" },
      { headers: PRIVATE_HEADERS },
    );
    response.headers.append("set-cookie", expiredSimulationSessionCookie());
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleSimulationTurnPost(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const body = await readBoundedJsonBody(request, { maxBytes: 2_048 });
  if (!body.ok) return body.response;
  const validated = validateSimulationTurnRequest(body.value);
  if (!validated.ok) {
    return Response.json(
      { error: validated.message, code: validated.code },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    return Response.json(await submitSimulationTurn(request, validated.value), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return jsonError(error);
  }
}
