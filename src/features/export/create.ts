import { createHash } from "node:crypto";
import { z } from "zod";
import { buildRevControlWorkbook } from "./build-workbook";
import { mapRevControlRows } from "./map-rows";
import { exportSnapshots, pairKey, selectExportEvents } from "./selection";
import type { ExportEvent, ExportSnapshot } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const exportRequestSchema = z.object({
  requestKey: z.uuid(), from: date, to: date,
  hotelIds: z.array(z.uuid()).min(1), mode: z.enum(["new", "selected", "all"]),
  selectedPairs: z.array(z.string()).default([]),
  choices: z.array(z.object({ eventId: z.uuid(), hotelId: z.uuid(), importance: z.enum(["Low", "Medium", "High", "Peak"]) })).default([]),
}).refine((input) => input.to >= input.from, "Controleer de periode.");
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export class ExportConflict extends Error {}

export async function createExport(input: ExportRequest, dependencies: {
  find: (key: string) => Promise<{ id: string; request_hash: string } | null>;
  load: (input: ExportRequest) => Promise<ExportEvent[]>;
  build?: typeof buildRevControlWorkbook;
  commit: (input: ExportRequest, hash: string, bytes: Buffer, items: ExportSnapshot[]) => Promise<string>;
}) {
  input = { requestKey: input.requestKey, from: input.from, to: input.to, mode: input.mode,
    hotelIds: [...new Set(input.hotelIds)].sort(), selectedPairs: [...new Set(input.selectedPairs)].sort(),
    choices: input.choices.map(({ eventId, hotelId, importance }) => ({ eventId, hotelId, importance })).sort((a, b) => pairKey(a.eventId, a.hotelId).localeCompare(pairKey(b.eventId, b.hotelId))) };
  if (new Set(input.choices.map((choice) => pairKey(choice.eventId, choice.hotelId))).size !== input.choices.length) throw new ExportConflict("Dubbele exportkeuze.");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = await dependencies.find(input.requestKey);
  if (previous) {
    if (previous.request_hash !== hash) throw new ExportConflict("Deze downloadaanvraag is gewijzigd. Vernieuw het voorbeeld.");
    return previous.id;
  }
  const events = await dependencies.load(input);
  const selected = selectExportEvents(events, input.mode, input.selectedPairs, input.choices);
  const items = exportSnapshots(selected);
  const keys = new Set(items.map((item) => pairKey(item.eventId, item.hotelId)));
  if (input.selectedPairs.some((key) => !keys.has(key)) || input.choices.some((choice) => !keys.has(pairKey(choice.eventId, choice.hotelId)))) {
    throw new ExportConflict("De selectie is gewijzigd of een exportniveau ontbreekt. Vernieuw het voorbeeld.");
  }
  if (!items.length) throw new ExportConflict("Geen nieuwe exporteerbare events voor deze selectie.");
  const bytes = await (dependencies.build ?? buildRevControlWorkbook)(mapRevControlRows(selected, input.hotelIds));
  return dependencies.commit(input, hash, bytes, items);
}
