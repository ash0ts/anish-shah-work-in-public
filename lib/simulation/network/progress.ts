import { z } from "zod";
import { ENCOUNTERS, PROGRAMS } from "./battle";
export const PROGRESS_KEY = "4n1sh:network-progress:v1";
const identifier = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/);
export const progressSchema = z
  .object({
    version: z.literal(1),
    discoveries: z.array(identifier).max(48),
    equipped: z
      .array(
        z
          .object({
            program: z.enum(PROGRAMS),
            discoveryId: identifier.nullable(),
          })
          .strict(),
      )
      .length(6),
    completed: z.array(z.enum(ENCOUNTERS)).max(3),
    stepMode: z.boolean(),
    sound: z.boolean(),
  })
  .strict();
export type Progress = z.infer<typeof progressSchema>;
export function readProgress(
  value: string | null,
  visibleIds: ReadonlySet<string>,
): Progress | null {
  if (!value || value.length > 12_000) return null;
  try {
    const result = progressSchema.safeParse(JSON.parse(value));
    if (!result.success) return null;
    return {
      ...result.data,
      discoveries: [...new Set(result.data.discoveries)].filter((id) =>
        visibleIds.has(id),
      ),
      equipped: result.data.equipped.map((slot) => ({
        ...slot,
        discoveryId:
          slot.discoveryId && visibleIds.has(slot.discoveryId)
            ? slot.discoveryId
            : null,
      })),
      completed: [...new Set(result.data.completed)],
    };
  } catch {
    return null;
  }
}
