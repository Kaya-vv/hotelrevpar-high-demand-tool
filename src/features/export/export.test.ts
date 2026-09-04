import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildRevControlWorkbook, REVCONTROL_HEADERS } from "./build-workbook";
import { exportableEvents, mapRevControlRows } from "./map-rows";
import { exportRange } from "./query";
import type { ExportEvent } from "./types";

describe("RevControl export", () => {
  it("groups one event by final hotel importance and keeps approved fields blank", async () => {
    const rows = mapRevControlRows(
      [{
        id: "event-1",
        title: "Dutch Design Week",
        startAt: "2027-10-16T10:00:00+02:00",
        endAt: "2027-10-24T22:00:00+02:00",
        hotels: [
          { id: "hotel-1", code: "MATCH", importance: "High", impactBasis: "attendance" },
          { id: "hotel-2", code: "REINE", importance: "Medium", impactBasis: "attendance" },
          { id: "hotel-3", code: "PEAK", importance: "Peak", impactBasis: "attendance" },
          { id: "hotel-4", code: "LOW", importance: "Low", impactBasis: "attendance" },
          { id: "hotel-5", code: "DEFAULT", importance: "Medium", impactBasis: "default" },
        ],
      }],
      ["hotel-1", "hotel-2", "hotel-3", "hotel-4", "hotel-5"],
    );
    const buffer = await buildRevControlWorkbook(rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.getWorksheet("Blad1")!;

    expect(sheet.getRow(1).values).toEqual([undefined, ...REVCONTROL_HEADERS]);
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("Yes");
    expect(sheet.getCell("J2").value).toBe("MATCH, PEAK");
    expect(sheet.getCell("C2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("D2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("C2").numFmt).toBe("dd-mm-yyyy");
    expect(sheet.getCell("D2").numFmt).toBe("dd-mm-yyyy");
    expect(sheet.getCell("I2").value).toBe("Both");
    ["F2", "G2", "H2", "K2", "L2", "M2"].forEach((cell) => expect(sheet.getCell(cell).value).toBeNull());
  });

  it("counts only the events that reach the workbook", () => {
    const events: ExportEvent[] = [
      {
        id: "event-1",
        title: "Dutch Design Week",
        startAt: "2027-10-16T10:00:00+02:00",
        endAt: "2027-10-24T22:00:00+02:00",
        hotels: [{ id: "hotel-1", code: "MATCH", importance: "High", impactBasis: "attendance" }],
      },
      {
        id: "event-2",
        title: "Lokale kroegavond",
        startAt: "2027-10-18T20:00:00+02:00",
        endAt: "2027-10-18T23:00:00+02:00",
        hotels: [{ id: "hotel-1", code: "MATCH", importance: "Medium", impactBasis: "attendance" }],
      },
      {
        id: "event-3",
        title: "Event van een ander hotel",
        startAt: "2027-10-20T10:00:00+02:00",
        endAt: "2027-10-20T18:00:00+02:00",
        hotels: [{ id: "hotel-2", code: "OTHER", importance: "Peak", impactBasis: "attendance" }],
      },
    ];

    // The preview headline used every active decision in range, so it read far higher than
    // the row count it sat next to.
    expect(exportableEvents(events, ["hotel-1"]).map((event) => event.id)).toEqual(["event-1"]);
    expect(mapRevControlRows(exportableEvents(events, ["hotel-1"]), ["hotel-1"])).toHaveLength(1);
  });

  it("defaults the export range to the 90-day collection window", () => {
    const today = new Date("2026-09-03T12:00:00Z");

    expect(exportRange(null, null, today)).toEqual({
      start: "2026-09-03",
      end: "2026-12-02",
    });
    expect(exportRange("2026-10-01", "2027-01-31", today)).toEqual({
      start: "2026-10-01",
      end: "2027-01-31",
    });
    // A reversed range is a slip of the mouse, not an empty export.
    expect(exportRange("2027-01-31", "2026-10-01", today)).toEqual({
      start: "2026-10-01",
      end: "2027-01-31",
    });
    expect(exportRange("not-a-date", "2026-09-30", today)).toEqual({
      start: "2026-09-03",
      end: "2026-09-30",
    });
  });
});
