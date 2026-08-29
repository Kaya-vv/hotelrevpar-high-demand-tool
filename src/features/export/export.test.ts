import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildRevControlWorkbook, REVCONTROL_HEADERS } from "./build-workbook";
import { mapRevControlRows } from "./map-rows";

describe("RevControl export", () => {
  it("groups one event by final hotel importance and keeps approved fields blank", async () => {
    const rows = mapRevControlRows(
      [{
        id: "event-1",
        title: "Dutch Design Week",
        startAt: "2027-10-16T10:00:00+02:00",
        endAt: "2027-10-24T22:00:00+02:00",
        hotels: [
          { id: "hotel-1", code: "MATCH", importance: "High" },
          { id: "hotel-2", code: "REINE", importance: "Medium" },
          { id: "hotel-3", code: "PEAK", importance: "Peak" },
        ],
      }],
      ["hotel-1", "hotel-2", "hotel-3"],
    );
    const buffer = await buildRevControlWorkbook(rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.getWorksheet("Blad1")!;

    expect(sheet.getRow(1).values).toEqual([undefined, ...REVCONTROL_HEADERS]);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell("A2").value).toBe("Yes");
    expect(sheet.getCell("J2").value).toBe("MATCH, PEAK");
    expect(sheet.getCell("J3").value).toBe("REINE");
    expect(sheet.getCell("C2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("D2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("C2").numFmt).toBe("dd-mm-yyyy");
    expect(sheet.getCell("D2").numFmt).toBe("dd-mm-yyyy");
    ["F2", "G2", "H2", "I2", "K2", "L2", "M2"].forEach((cell) => expect(sheet.getCell(cell).value).toBeNull());
  });
});
