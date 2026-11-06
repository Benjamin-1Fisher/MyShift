import { z } from "zod";
import { localDate, type Assignment, type Data } from "./domain";

export const shiftPeriods = ["morning", "evening", "night"] as const;
export type ShiftPeriod = (typeof shiftPeriods)[number];
export const periodLabels: Record<ShiftPeriod, string> = {
  morning: "בוקר",
  evening: "ערב",
  night: "לילה",
};
export const weekdayLabels = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];
export const weeklyAvailabilitySchema = z
  .array(
    z
      .array(z.enum(shiftPeriods))
      .max(3)
      .refine((periods) => new Set(periods).size === periods.length),
  )
  .length(7)
  .refine(
    (days) => days.some((periods) => periods.length > 0),
    "יש לבחור לפחות משמרת אחת או לבחור הכול",
  )
  .nullable();
export type WeeklyAvailability = z.infer<typeof weeklyAvailabilitySchema>;

export function unrestrictedWeek(): ShiftPeriod[][] {
  return Array.from({ length: 7 }, () => [...shiftPeriods]);
}
export function normalizeWeeklyAvailability(
  value: WeeklyAvailability,
): WeeklyAvailability {
  return !value || value.every((periods) => periods.length === 3)
    ? null
    : value.map((periods) =>
        shiftPeriods.filter((period) => periods.includes(period)),
      );
}
export function weeklyAvailabilitySummary(value: unknown) {
  const parsed = weeklyAvailabilitySchema.safeParse(value ?? null);
  if (!parsed.success)
    return Array.isArray(value) &&
      value.length === 7 &&
      value.every((periods) => Array.isArray(periods) && !periods.length)
      ? "טרם נבחרו משמרות"
      : "זמינות דורשת עדכון";
  const days = normalizeWeeklyAvailability(parsed.data);
  if (!days) return "כל הימים והמשמרות";
  const selected = days.flatMap((periods, day) =>
    periods.length ? [day] : [],
  );
  if (selected.length === 1)
    return `${weekdayLabels[selected[0]]}: ${days[selected[0]].map((period) => periodLabels[period]).join(", ")}`;
  if (
    days.every((periods) => periods.length === 1 && periods[0] === days[0][0])
  )
    return `${periodLabels[days[0][0]]} בלבד · כל השבוע`;
  return `${selected.map((day) => weekdayLabels[day]).join(", ")} · לפי הבחירה`;
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

export function shiftPeriod(
  data: Pick<Data, "shift_templates">,
  shift: Assignment,
): ShiftPeriod {
  const start = clock(shift.starts_at),
    end = clock(shift.ends_at);
  const template = data.shift_templates
    .filter(
      (t) =>
        t.department_id === shift.department_id &&
        t.confirmed &&
        String(t.start_time).slice(0, 5) === start &&
        String(t.end_time).slice(0, 5) === end &&
        shiftPeriods.some((period) =>
          String(t.name).trim().startsWith(periodLabels[period]),
        ),
    )
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (template)
    return shiftPeriods.find((period) =>
      String(template.name).trim().startsWith(periodLabels[period]),
    )!;
  return start >= "07:00" && start < "15:00"
    ? "morning"
    : start >= "15:00" && start < "23:00"
      ? "evening"
      : "night";
}

export function isWeeklyAvailable(
  data: Data,
  shift: Assignment,
  employeeId: string,
) {
  const employee = data.employees.find((e) => e.id === employeeId);
  if (!employee) return false;
  const parsed = weeklyAvailabilitySchema.safeParse(
    employee.weekly_availability ?? null,
  );
  if (!parsed.success) return false;
  if (!parsed.data) return true;
  const day = new Date(localDate(shift.starts_at) + "T12:00:00Z").getUTCDay();
  return parsed.data[day].includes(shiftPeriod(data, shift));
}
