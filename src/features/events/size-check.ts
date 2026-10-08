import { z } from "zod";

/**
 * A general-knowledge answer to "does this event bring many overnight visitors from outside the
 * region?". It is asked only where the sources prove the right kind of visitor but never the size
 * (the shown Medium tier): the International Film Festival Rotterdam and a library's children's
 * book week scored identically on source evidence alone. See `scoreHotelEvent` for how it grades.
 */
export const eventSizeCheckSchema = z.object({
  version: z.literal(1),
  verdict: z.enum(["big", "small", "unsure"]),
  /** The model's rough visitor figure, for the operator; never used as a number. */
  visitors: z.string(),
  reason: z.string(),
  model: z.string(),
  checkedAt: z.string(),
});

export type EventSizeCheck = z.infer<typeof eventSizeCheckSchema>;

export function readEventSizeCheck(value: unknown): EventSizeCheck | undefined {
  const parsed = eventSizeCheckSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
