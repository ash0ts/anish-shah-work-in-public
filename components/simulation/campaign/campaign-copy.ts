import type { CuriosityVector } from "../types";
import { SITE_COPY } from "@/lib/copy";
import {
  SIMULATION_ACTION_COPY_IDS,
  SIMULATION_CURIOSITY_COPY_IDS,
} from "@/lib/simulation/campaign-copy-contract";

export const ACTION_COPY = Object.fromEntries(
  SIMULATION_ACTION_COPY_IDS.map((action) => [
    action,
    {
      label: SITE_COPY.simulation[`action-${action}-label`],
      hint: SITE_COPY.simulation[`action-${action}-hint`],
    },
  ]),
) as Record<string, { label: string; hint: string }>;

export const CURIOSITY_COPY = Object.fromEntries(
  SIMULATION_CURIOSITY_COPY_IDS.map((curiosity) => [
    curiosity,
    SITE_COPY.simulation[`curiosity-${curiosity}`],
  ]),
) as Record<CuriosityVector, string>;
