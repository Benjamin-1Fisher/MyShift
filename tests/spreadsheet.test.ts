import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, parseWorkbook } from "../src/lib/spreadsheet";
it("parses Hebrew CSV with commas, quotes and embedded line breaks", () => {
  expect(parseCsv('שם,הערה\r\n"בדיקה","א,ב\nג"\r\n')).toEqual([
    ["שם", "הערה"],
    ["בדיקה", "א,ב\nג"],
  ]);
  expect(() => parseCsv('"broken')).toThrow();
});
it("reads an actual workbook and rejects executable formulas", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("בדיקה");
  ws.addRow(["date", "start", "end"]);
  ws.addRow(["2026-11-01", "23:00", "07:00"]);
  let bytes = await wb.xlsx.writeBuffer();
  const file = () => new File([new Uint8Array(bytes)], "test.xlsx");
  expect(await parseWorkbook(file())).toEqual([
    { date: "2026-11-01", start: "23:00", end: "07:00" },
  ]);
  ws.getCell("A2").value = { formula: "1+1", result: 2 };
  bytes = await wb.xlsx.writeBuffer();
  await expect(parseWorkbook(file())).rejects.toThrow(/נוסחאות/);
});
