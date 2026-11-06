import ExcelJS from "exceljs";
// RFC 4180 CSV, including escaped quotes and embedded newlines. No formula evaluation.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      if (rows.length > 101) throw new Error("עד 100 שורות נתונים");
    } else cell += c;
  }
  if (quoted) throw new Error("מרכאות לא סגורות ב־CSV");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export async function parseWorkbook(file: File) {
  let rows: string[][];
  if (file.name.toLowerCase().endsWith(".csv"))
    rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
  else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("קובץ ללא גיליון");
    if (sheet.rowCount > 101 || sheet.columnCount > 50)
      throw new Error("עד 100 שורות ו־50 עמודות");
    rows = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, n) => {
        if (c.type === ExcelJS.ValueType.Formula)
          throw new Error("אין לייבא נוסחאות; המר לערכים תחילה");
        cells[n - 1] = c.text;
      });
      rows.push(cells);
    });
  }
  if (rows.length < 2) throw new Error("נדרשות כותרות ושורת נתונים");
  const headers = rows.shift()!.map((s) => s.trim());
  if (new Set(headers).size !== headers.length)
    throw new Error("כותרות כפולות");
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])),
  );
}
export async function exportWorkbook(
  rows: Record<string, string | number>[],
  filename: string,
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("סידור עבודה", { views: [{ rightToLeft: true }] });
  const keys = Object.keys(rows[0] || { תאריך: "" });
  ws.columns = keys.map((k) => ({ header: k, key: k, width: 22 }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const blob = new Blob([await wb.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
