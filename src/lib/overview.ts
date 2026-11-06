import { shortages, type Assignment, type Data, type Row } from "./domain";
import { canAssign, planWeek } from "./planner";

export type ScheduleFocus = "all" | "open" | "conflicts";
export type DepartmentOverview = {
  department: Row;
  status: "missing" | "draft" | "published";
  total: number;
  staffed: number;
  open: number;
  conflicts: number;
  missing: number;
  shortage: number;
  configured: boolean;
  issue: string | null;
};
export function buildDepartmentOverview(
  data: Data,
  week: string,
  departments: Row[],
): DepartmentOverview[] {
  return departments
    .filter((d) => d.active !== false)
    .map((department) => {
      const version = data.schedule_versions.find(
        (v) =>
          v.department_id === department.id &&
          v.week_start === week &&
          v.status !== "archived",
      );
      const shifts = data.shift_assignments.filter(
        (a) =>
          a.version_id === version?.id && a.department_id === department.id,
      );
      const coverage = data.coverage_requirements.filter(
        (r) => r.department_id === department.id,
      );
      const configured =
        data.sites.length > 0 &&
        data.roles.some((r) => r.department_id === department.id) &&
        (coverage.length > 0 ||
          data.shift_templates.some(
            (t) =>
              t.department_id === department.id &&
              t.confirmed &&
              t.start_time &&
              t.end_time,
          ));
      let missing = 0,
        shortage = 0,
        issue: string | null = null;
      try {
        shortage = shortages(
          {
            ...data,
            shift_assignments: shifts,
            coverage_requirements: coverage,
          },
          week,
        ).reduce((sum, r) => sum + r.missing, 0);
        if (configured)
          missing = planWeek(
            {
              ...data,
              schedule_versions: data.schedule_versions.map((v) =>
                v.id === version?.id ? { ...v, status: "draft" } : v,
              ),
            },
            week,
            "open",
            department.id,
          ).length;
      } catch (error) {
        issue = (error as Error).message;
      }
      const open = shifts.filter((a) => !a.employee_id).length;
      return {
        department,
        status:
          version?.status === "published"
            ? "published"
            : version
              ? "draft"
              : "missing",
        total: shifts.length,
        staffed: shifts.length - open,
        open,
        missing,
        shortage,
        configured,
        issue,
        conflicts: shifts.filter(
          (a) => a.employee_id && !canAssign(data, a, a.employee_id),
        ).length,
      };
    });
}
export function employeeWeekShifts(
  data: Data,
  week: string,
  employeeId: string | undefined,
  departments: Row[],
): Assignment[] {
  if (!employeeId) return [];
  const allowed = new Set(
    departments.filter((d) => d.active !== false).map((d) => d.id),
  );
  const versions = new Set(
    data.schedule_versions
      .filter(
        (v) =>
          v.week_start === week &&
          v.status === "published" &&
          allowed.has(String(v.department_id)),
      )
      .map((v) => v.id),
  );
  return data.shift_assignments
    .filter(
      (a) =>
        a.employee_id === employeeId &&
        versions.has(a.version_id) &&
        allowed.has(a.department_id),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
