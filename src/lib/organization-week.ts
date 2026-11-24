import {
  addDays,
  localDate,
  type Assignment,
  type Data,
  type Row,
} from "./domain";

export function organizationWeek(data: Data, departments: Row[], week: string) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const dayIndexes = new Map(dates.map((date, i) => [date, i]));
  const rows = departments.map((department) => ({
    department,
    status: "",
    days: dates.map((): Assignment[] => []),
  }));
  const byDepartment = new Map(rows.map((r) => [r.department.id, r]));
  const activeVersions = new Map<string, ReturnType<typeof byDepartment.get>>();
  for (const version of data.schedule_versions) {
    const row = byDepartment.get(String(version.department_id));
    if (
      !row ||
      version.week_start !== week ||
      (version.status !== "draft" && version.status !== "published")
    )
      continue;
    row.status = version.status;
    activeVersions.set(version.id, row);
  }
  const getDate = new Map<string, string>();
  for (const shift of data.shift_assignments) {
    const row = activeVersions.get(shift.version_id);
    if (!row || shift.department_id !== row.department.id) continue;
    const date = getDate.get(shift.starts_at) || localDate(shift.starts_at);
    getDate.set(shift.starts_at, date);
    const day = dayIndexes.get(date);
    if (day !== undefined) row.days[day].push(shift);
  }
  let total = 0;
  let unassigned = 0;
  for (const row of rows)
    for (const shifts of row.days) {
      shifts.sort(
        (a, b) =>
          Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
          Date.parse(a.ends_at) - Date.parse(b.ends_at) ||
          a.id.localeCompare(b.id),
      );
      total += shifts.length;
      unassigned += shifts.filter((s) => !s.employee_id).length;
    }
  return { dates, rows, total, unassigned };
}
