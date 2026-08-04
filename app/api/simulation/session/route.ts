import {
  handleSimulationSessionDelete,
  handleSimulationSessionGet,
  handleSimulationSessionPost,
} from "@/lib/server/simulation/http";

export const dynamic = "force-dynamic";

export const GET = handleSimulationSessionGet;
export const POST = handleSimulationSessionPost;
export const DELETE = handleSimulationSessionDelete;
