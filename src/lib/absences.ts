import { z } from "zod";
import { addDays, civilTime, localDate, type Row } from "./domain";

export const absenceReasons = [
  { id: "vacation", name: "חופשה" },
  { id: "sick", name: "מחלה" },
  { id: "personal", name: "יום אישי" },
  { id: "other", name: "היעדרות אחרת" },
] as const;
export const absenceSchema = z
  .object({
    id: z.uuid().optional(),
    employee_id: z.uuid(),
    starts_on: z.iso.date(),
    ends_on: z.iso.date(),
    absence_reason: z.enum(["vacation", "sick", "personal", "other"]),
  })
  .refine(
    (v) => v.ends_on >= v.starts_on,
    "תאריך הסיום צריך להיות ביום ההתחלה או אחריו",
  );
export function absenceInterval(from: string, through: string) {
  if (through < from)
    throw new Error("תאריך הסיום צריך להיות ביום ההתחלה או אחריו");
  return {
    starts_at: civilTime(from, "00:00"),
    ends_at: civilTime(addDays(through, 1), "00:00"),
  };
}
export function isAbsence(row: Row) {
  return row.kind === "leave" || row.kind === "unavailable";
}
export function absenceInWeek(row: Row, week: string) {
  return absencesForWeek([row], week).length > 0;
}
export function absencesForWeek(rows: Row[], week: string) {
  const from = Date.parse(civilTime(week, "00:00"));
  const to = Date.parse(civilTime(addDays(week, 7), "00:00"));
  return rows.filter(
    (row) =>
      isAbsence(row) &&
      Date.parse(String(row.starts_at)) < to &&
      Date.parse(String(row.ends_at)) > from,
  );
}
export function absenceDate(day: string) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(day + "T12:00:00Z"));
}
export function absenceEndDay(row: Row) {
  return localDate(new Date(Date.parse(String(row.ends_at)) - 1).toISOString());
}
export function absenceLabel(row: Row) {
  return (
    absenceReasons.find((reason) => reason.id === row.absence_reason)?.name ||
    (row.kind === "leave" ? "חופשה" : "היעדרות אחרת")
  );
}
export function isWholeDayAbsence(row: Row) {
  return (
    Date.parse(String(row.starts_at)) ===
      Date.parse(civilTime(localDate(String(row.starts_at)), "00:00")) &&
    Date.parse(String(row.ends_at)) ===
      Date.parse(civilTime(localDate(String(row.ends_at)), "00:00"))
  );
}
