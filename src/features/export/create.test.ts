import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createExport, exportRequestSchema, type ExportRequest } from "./create";
import { currentExportSnapshot, exportSnapshots, pairKey, selectExportEvents } from "./selection";
import { mapRevControlRows } from "./map-rows";
import type { ExportEvent } from "./types";

const hotelA = randomUUID(), hotelB = randomUUID();
const makeEvent = (id = randomUUID()): ExportEvent => ({ id, title: "Concert", startAt: "2027-01-10T12:00:00+01:00", endAt: "2027-01-10T23:00:00+01:00", status: "active", hotels: [hotelA, hotelB].map((id) => ({ id, code: id === hotelA ? "A" : "B", importance: "High", impactBasis: "demand_rule", available: true })) });
const request = (): ExportRequest => ({ requestKey: randomUUID(), from: "2026-09-01", to: "2027-12-31", hotelIds: [hotelA, hotelB], mode: "new", selectedPairs: [], choices: [] });

describe("incremental hotel exports", () => {
  it("exports 40, then only the new addition for A, while B still receives all 41", () => {
    const events = Array.from({ length: 40 }, () => makeEvent());
    expect(selectExportEvents(events, "new", [], [])).toHaveLength(40);
    events.forEach((event) => { event.hotels[0].exportedAt = "2026-09-08"; });
    events.push(makeEvent());
    const result = selectExportEvents(events, "new", [], []);
    expect(result.flatMap((event) => event.hotels.filter((hotel) => hotel.id === hotelA))).toHaveLength(1);
    expect(mapRevControlRows(result, [hotelA, hotelB]).filter((row) => row.hotels === "B")).toHaveLength(40);
    expect(mapRevControlRows(result, [hotelA, hotelB]).filter((row) => row.hotels === "A, B")).toHaveLength(1);
  });
  it("requires selection and a manual level for announcements; never changes AI scores", () => {
    const event = makeEvent();
    event.hotels = [{ ...event.hotels[0], importance: "Medium", announced: true, exportLevel: "Low" }];
    const key = pairKey(event.id, hotelA);
    expect(selectExportEvents([event], "all", [], [])).toEqual([]);
    expect(selectExportEvents([event], "new", [key], [])).toEqual([]);
    const selected = selectExportEvents([event], "new", [key], [{ eventId: event.id, hotelId: hotelA, importance: "Low" }]);
    expect(mapRevControlRows(selected, [hotelA])[0].importance).toBe("Low");
    expect(event.hotels[0].importance).toBe("Medium");
    expect(selectExportEvents([{ ...event, hotels: [{ ...event.hotels[0], announced: false }] }], "all", [key], [])).toEqual([]);
    expect(selectExportEvents([{ ...event, hotels: [{ ...event.hotels[0], available: false }] }], "all", [key], [{ eventId: event.id, hotelId: hotelA, importance: "High" }])).toEqual([]);
  });
  it("allows explicit selected/full re-export and flags changed or cancelled exports", () => {
    const event = makeEvent(); event.hotels[0].exportedAt = "2026-09-08";
    expect(selectExportEvents([event], "selected", [pairKey(event.id, hotelA)], [])[0].hotels).toHaveLength(1);
    expect(selectExportEvents([event], "all", [], [])[0].hotels).toHaveLength(2);
    const previous = exportSnapshots([event])[0];
    expect(currentExportSnapshot(event, hotelA, previous).changed).toBe(false);
    expect(currentExportSnapshot({ ...event, title: "Updated" }, hotelA, previous).changed).toBe(true);
    expect(currentExportSnapshot({ ...event, status: "cancelled", hotels: [{ ...event.hotels[0], available: false }] }, hotelA, previous)).toMatchObject({ eligible: false, changed: true });
    expect(currentExportSnapshot(undefined, hotelA, previous).changed).toBe(true);
  });
  it("does not persist on generation failure, retries the same batch after response loss, and rejects changed request keys", async () => {
    const input = request();
    let saved: { id: string; request_hash: string } | null = null;
    const load = vi.fn(async () => [makeEvent()]);
    const commit = vi.fn(async (_input, hash) => { saved = { id: "saved", request_hash: hash }; return "saved"; });
    const deps = { find: async () => saved, load, commit };
    await expect(createExport(input, { ...deps, build: async () => { throw new Error("XLSX failed"); } })).rejects.toThrow("XLSX failed");
    expect(commit).not.toHaveBeenCalled();
    expect(await createExport(input, deps)).toBe("saved");
    const calls = load.mock.calls.length;
    expect(await createExport(input, deps)).toBe("saved");
    expect(load).toHaveBeenCalledTimes(calls);
    expect(commit).toHaveBeenCalledTimes(1);
    await expect(createExport({ ...input, to: "2027-11-30" }, deps)).rejects.toThrow("gewijzigd");
  });
  it("does not commit empty or stale explicit selections", async () => {
    const commit = vi.fn(); const input = request();
    const deps = { find: async () => null, load: async () => [], commit };
    await expect(createExport(input, deps)).rejects.toThrow("Geen nieuwe");
    await expect(createExport({ ...input, selectedPairs: ["missing"] }, deps)).rejects.toThrow("selectie is gewijzigd");
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects impossible dates and accepts year rollover", () => {
    expect(exportRequestSchema.safeParse({ ...request(), from: "2027-02-30" }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ ...request(), from: "2026-12-31", to: "2027-01-01" }).success).toBe(true);
  });
});
