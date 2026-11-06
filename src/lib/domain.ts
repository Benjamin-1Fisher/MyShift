import { z } from "zod";
export const assignmentSchema = z
  .object({
    department_id: z.uuid(),
    site_id: z.uuid(),
    role_id: z.uuid(),
    employee_id: z.uuid().nullable(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) =>
      Date.parse(v.ends_at) > Date.parse(v.starts_at) &&
      Date.parse(v.ends_at) - Date.parse(v.starts_at) <= 86400000,
    "משך משמרת לא תקין",
  );
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), ...assignmentSchema.shape }),
  z.object({
    kind: z.literal("update"),
    id: z.uuid(),
    ...assignmentSchema.shape,
  }),
  z.object({ kind: z.literal("delete"), id: z.uuid() }),
]);
export type Operation = z.infer<typeof operationSchema>;
export type Row = { id: string; [key: string]: unknown };
export type Assignment = {
  id: string;
  version_id: string;
  department_id: string;
  site_id: string;
  role_id: string;
  employee_id: string | null;
  starts_at: string;
  ends_at: string;
};
export type Data = {
  profiles: Row[];
  departments: Row[];
  manager_departments: Row[];
  sites: Row[];
  roles: Row[];
  employees: Row[];
  employee_departments: Row[];
  shift_templates: Row[];
  settings: Row[];
  schedule_versions: Row[];
  shift_assignments: Assignment[];
  availability: Row[];
  coverage_requirements: Row[];
  notifications: Row[];
  audit_logs: Row[];
};
export const tables = [
  "profiles",
  "departments",
  "manager_departments",
  "sites",
  "roles",
  "employees",
  "employee_departments",
  "shift_templates",
  "settings",
  "schedule_versions",
  "shift_assignments",
  "availability",
  "coverage_requirements",
  "notifications",
  "audit_logs",
] as const;
export function overlaps(
  a: { starts_at: string; ends_at: string },
  b: { starts_at: string; ends_at: string },
) {
  return (
    Date.parse(a.starts_at) < Date.parse(b.ends_at) &&
    Date.parse(a.ends_at) > Date.parse(b.starts_at)
  );
}
export function duration(a: { starts_at: string; ends_at: string }) {
  return (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 3600000;
}
export function localDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
export function sunday(date = new Date()) {
  const day = localDate(date.toISOString());
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Resolve Jerusalem civil time explicitly; reject nonexistent spring-forward times.
export function civilTime(day: string, time: string) {
  const target = day + "T" + time.slice(0, 5);
  const naive = Date.parse(target + ":00Z");
  for (const offset of [2, 3]) {
    const d = new Date(naive - offset * 3600000);
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "short",
      timeStyle: "short",
      hourCycle: "h23",
    })
      .format(d)
      .replace(" ", "T");
    if (parts === target) return d.toISOString();
  }
  throw new Error("שעה מקומית אינה קיימת במעבר לשעון קיץ");
}
export function interval(day: string, start: string, end: string) {
  return {
    starts_at: civilTime(day, start),
    ends_at: civilTime(end <= start ? addDays(day, 1) : day, end),
  };
}
export function shortages(data: Data, week: string) {
  return data.coverage_requirements
    .map((r) => {
      const day = addDays(week, Number(r.weekday));
      const t = interval(
        day,
        String(r.start_time).slice(0, 5),
        String(r.end_time).slice(0, 5),
      );
      const count = data.shift_assignments.filter(
        (a) =>
          a.department_id === r.department_id &&
          a.site_id === r.site_id &&
          a.role_id === r.role_id &&
          a.employee_id &&
          Date.parse(a.starts_at) <= Date.parse(t.starts_at) &&
          Date.parse(a.ends_at) >= Date.parse(t.ends_at),
      ).length;
      return {
        requirement: r,
        day,
        ...t,
        missing: Math.max(0, Number(r.required_count) - count),
      };
    })
    .filter((r) => r.missing > 0);
}

// Available windows constrain their submitted week; old submissions do not lock
// the employee out of every future week. Leave/unavailable windows remain global.
export function availabilityWindows(
  data: Data,
  employeeId: string,
  startsAt: string,
) {
  const week = sunday(new Date(startsAt));
  const from = civilTime(week, "00:00"),
    to = civilTime(addDays(week, 7), "00:00");
  return data.availability.filter(
    (w) =>
      w.employee_id === employeeId &&
      (w.kind !== "available" ||
        (String(w.starts_at) < to && String(w.ends_at) > from)),
  );
}
