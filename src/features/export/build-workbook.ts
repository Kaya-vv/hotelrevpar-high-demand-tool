import ExcelJS from "exceljs";

import type { RevControlRow } from "./types";

export const REVCONTROL_HEADERS = [
  "Show",
  "Event",
  "Start date",
  "End date",
  "Importance",
  "Supplement Percentage",
  "Supplement",
  "MLS",
  "Add supplement for",
  "Hotel(s)",
  "Split per hotel",
  "Note",
  "Source",
] as const;

const widths = [6.33, 23.33, 11.5, 10.5, 12.66, 24, 12.5, 7.5, 20.66, 31, 15, 14.83, 14];

export async function buildRevControlWorkbook(rows: RevControlRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Blad1");
  sheet.columns = widths.map((width) => ({ width }));
  sheet.addTable({
    name: "EventsTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleLight1", showRowStripes: false },
    columns: REVCONTROL_HEADERS.map((name) => ({ name })),
    rows: rows.map((row) => [
      row.show,
      row.event,
      row.startDate,
      row.endDate,
      row.importance,
      row.supplementPercentage,
      row.supplement,
      row.mls,
      row.addSupplementFor,
      row.hotels,
      row.splitPerHotel,
      row.note,
      row.source,
    ]),
  });
  sheet.getRow(1).font = { name: "Calibri", size: 12, bold: true, italic: true, color: { argb: "FF000000" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC7DAF1" } };
  sheet.getRows(2, rows.length)?.forEach((row) => {
    row.font = { name: "Calibri", size: 11, bold: false, italic: false, color: { argb: "FF000000" } };
  });
  sheet.getColumn(3).numFmt = "dd-mm-yyyy";
  sheet.getColumn(4).numFmt = "dd-mm-yyyy";
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
