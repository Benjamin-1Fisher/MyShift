import {
  addDays,
  availabilityWindows,
  duration,
  interval,
  localDate,
  overlaps,
  type Assignment,
  type Data,
  type Operation,
  type Row,
} from "./domain";
import { isWeeklyAvailable } from "./weekly-availability";

type PlannedOperation = Assignment & { kind: "create" | "update" };

export type WeeklyPlanTarget = {
  week: string;
  departmentId: string;
  versionId?: string;
  revision: number;
  status: "draft" | "published" | null;
  operations: PlannedOperation[];
};

export type WeeklyPlanGroup = {
  department: Row;
  target: WeeklyPlanTarget;
  unavailable?: { label: string; detail: string };
};

export function canAssign(
  data: Data,
  shift: Assignment,
  employeeId: string,
  all = data.shift_assignments,
) {
  return !assignmentIssue(data, shift, employeeId, all);
}

export function assignmentIssue(
  data: Data,
  shift: Assignment,
  employeeId: string,
  all = data.shift_assignments,
) {
  if (!data.employees.some((e) => e.id === employeeId && e.active))
    return "העובד אינו פעיל";
  if (!isWeeklyAvailable(data, shift, employeeId)) return "מחוץ לזמינות הקבועה";
  if (
    !data.employee_departments.some(
      (m) =>
        m.employee_id === employeeId &&
        m.department_id === shift.department_id &&
        m.role_id === shift.role_id,
    )
  )
    return "חסרה הכשרה לתפקיד";
  const windows = availabilityWindows(data, employeeId, shift.starts_at);
  if (
    windows.some(
      (w) =>
        w.kind !== "available" && overlaps(shift, w as unknown as Assignment),
    )
  )
    return "העובד אינו זמין בשעות המשמרת";
  const allowed = windows.filter((w) => w.kind === "available");
  if (
    allowed.length &&
    !allowed.some(
      (w) =>
        Date.parse(String(w.starts_at)) <= Date.parse(shift.starts_at) &&
        Date.parse(String(w.ends_at)) >= Date.parse(shift.ends_at),
    )
  )
    return "מחוץ לשעות הזמינות";
  const rest = Number(data.settings[0]?.min_rest_hours ?? 0);
  const other = all.find(
    (other) =>
      other.id !== shift.id &&
      other.employee_id === employeeId &&
      !data.schedule_versions.some(
        (v) => v.id === other.version_id && v.status === "archived",
      ) &&
      (overlaps(shift, other) ||
        Math.max(
          Date.parse(shift.starts_at) - Date.parse(other.ends_at),
          Date.parse(other.starts_at) - Date.parse(shift.ends_at),
        ) /
          3600000 <
          rest),
  );
  if (!other) return null;
  return overlaps(shift, other) ? "חפיפה עם משמרת אחרת" : "זמן מנוחה קצר מהמותר";
}

// Deterministic staffing rules, independent of AI. Existing assignments are never replaced.
export function planWeek(
  data: Data,
  week: string,
  mode: "generate" | "fill" | "open",
  departmentId = data.departments[0]?.id,
) {
  const scope = (id: unknown) => !departmentId || id === departmentId;
  const version = data.schedule_versions.find(
    (v) =>
      v.week_start === week &&
      v.status !== "archived" &&
      scope(v.department_id),
  );
  if (version && version.status !== "draft")
    throw new Error(
      version.status === "archived"
        ? "יש לשחזר את הסידור לפני עריכה"
        : "יש לפתוח את הסידור לעריכה תחילה",
    );
  const existing = data.shift_assignments.filter(
    (a) => a.version_id === version?.id,
  );
  const created: Assignment[] = [];
  if (mode !== "fill") {
    const requirements = new Map<
      string,
      { shift: Assignment; count: number }
    >();
    const add = (
      department: string,
      site: string,
      role: string,
      day: string,
      start: string,
      end: string,
      count: number,
      minimum = false,
    ) => {
      const shift: Assignment = {
        id: crypto.randomUUID(),
        version_id: version?.id || "",
        department_id: department,
        site_id: site,
        role_id: role,
        employee_id: null,
        ...interval(day, start, end),
      };
      if (duration(shift) > Number(data.settings[0]?.max_shift_hours ?? 24))
        throw new Error("אחת התבניות ארוכה מהמותר. יש לתקן אותה בהגדרות");
      const key = [department, site, role, shift.starts_at, shift.ends_at].join(
        "|",
      );
      const previous = requirements.get(key);
      requirements.set(key, {
        shift,
        count: minimum
          ? Math.max(previous?.count || 0, count)
          : (previous?.count || 0) + count,
      });
    };
    if (!data.sites.length || !data.roles.length)
      throw new Error("יש להוסיף אתר ותפקיד לפני יצירת שבוע");
    const coverage = data.coverage_requirements.filter((r) =>
      scope(r.department_id),
    );
    for (const r of coverage)
      add(
        String(r.department_id),
        String(r.site_id),
        String(r.role_id),
        addDays(week, Number(r.weekday)),
        String(r.start_time).slice(0, 5),
        String(r.end_time).slice(0, 5),
        Number(r.required_count),
      );
    for (const role of data.roles.filter(
      (r) =>
        scope(r.department_id) &&
        data.departments.some(
          (d) => d.id === r.department_id && d.active !== false,
        ),
    )) {
      const roleCoverage = coverage.filter((r) => r.role_id === role.id);
      // Coverage can increase staffing without removing the rest of the week.
      // Custom, day-specific hours remain scoped to their explicit requirements.
      const templates = data.shift_templates.filter(
        (t) =>
          t.department_id === role.department_id &&
          t.confirmed &&
          t.start_time &&
          t.end_time &&
          (!roleCoverage.length ||
            ["בוקר", "ערב", "לילה"].includes(String(t.name))),
      );
      const sites = roleCoverage.length
        ? data.sites.filter((s) => roleCoverage.some((r) => r.site_id === s.id))
        : data.sites.slice(0, 1);
      for (const site of sites)
        for (let day = 0; day < 7; day++)
          for (const t of templates)
            add(
              String(role.department_id),
              site.id,
              role.id,
              addDays(week, day),
              String(t.start_time).slice(0, 5),
              String(t.end_time).slice(0, 5),
              1,
              true,
            );
    }
    if (!requirements.size)
      throw new Error("יש להגדיר ולאמת שעות משמרת למחלקה לפני יצירת סידור");
    for (const { shift, count } of requirements.values()) {
      const found = existing.filter(
        (a) =>
          a.department_id === shift.department_id &&
          a.site_id === shift.site_id &&
          a.role_id === shift.role_id &&
          Date.parse(a.starts_at) === Date.parse(shift.starts_at) &&
          Date.parse(a.ends_at) === Date.parse(shift.ends_at),
      ).length;
      if (count - found + created.length > 100)
        throw new Error(
          "עד 100 משמרות בפעולה. צמצמו את דרישות האיוש לפני היצירה",
        );
      for (let n = found; n < count; n++)
        created.push({ ...shift, id: crypto.randomUUID() });
    }
  }
  const working = data.shift_assignments.concat(created).map((a) => ({ ...a }));
  const workingById = new Map(working.map((shift) => [shift.id, shift]));
  const operations: PlannedOperation[] = [];
  const createdIds = new Set(created.map((shift) => shift.id));
  const weeklyHours = new Map<string, number>();
  if (mode !== "open") {
    const endOfWeek = addDays(week, 6);
    const archivedVersions = new Set(
      data.schedule_versions
        .filter((version) => version.status === "archived")
        .map((version) => version.id),
    );
    for (const shift of working) {
      if (!shift.employee_id || archivedVersions.has(shift.version_id))
        continue;
      const day = localDate(shift.starts_at);
      if (day >= week && day <= endOfWeek) {
        weeklyHours.set(
          shift.employee_id,
          (weeklyHours.get(shift.employee_id) ?? 0) + duration(shift),
        );
      }
    }
  }
  const targets = (
    mode === "open"
      ? created
      : existing.filter((a) => !a.employee_id).concat(created)
  ).sort(
    (a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      Number(createdIds.has(a.id)) - Number(createdIds.has(b.id)) ||
      Date.parse(a.ends_at) - Date.parse(b.ends_at) ||
      a.site_id.localeCompare(b.site_id) ||
      a.role_id.localeCompare(b.role_id) ||
      // Matching generated shifts retain their insertion order.
      (createdIds.has(a.id) ? 0 : a.id.localeCompare(b.id)),
  );
  for (const shift of targets) {
    const current = workingById.get(shift.id)!;
    if (mode !== "open") {
      current.employee_id =
        data.employees
          .filter((e) => canAssign(data, current, e.id, working))
          .sort(
            (a, b) =>
              (weeklyHours.get(a.id) ?? 0) - (weeklyHours.get(b.id) ?? 0) ||
              String(a.name).localeCompare(String(b.name), "he") ||
              a.id.localeCompare(b.id),
          )[0]?.id || null;
      if (current.employee_id) {
        weeklyHours.set(
          current.employee_id,
          (weeklyHours.get(current.employee_id) ?? 0) + duration(current),
        );
      }
    }
    if (createdIds.has(shift.id))
      operations.push({ ...current, kind: "create" });
    else if (current.employee_id)
      operations.push({ ...current, kind: "update" });
  }
  if (operations.length > 100)
    throw new Error("עד 100 שינויים בפעולה. השתמשו במסנן או פצלו את השבוע");
  return operations;
}

export function planDepartments(
  data: Data,
  week: string,
  departments: Row[],
): WeeklyPlanGroup[] {
  const working = new Map(
    data.shift_assignments.map((shift) => [shift.id, shift]),
  );
  const ordered = departments
    .filter((department) => department.active !== false)
    .sort((a, b) => a.id.localeCompare(b.id));

  return ordered.map((department) => {
    const departmentId = department.id;
    const versions = data.schedule_versions.filter(
      (version) =>
        version.department_id === departmentId && version.week_start === week,
    );
    const active = versions.find(
      (version) => version.status === "draft" || version.status === "published",
    );
    const status =
      active?.status === "published" ? "published" : active ? "draft" : null;
    const target: WeeklyPlanTarget = {
      week,
      departmentId,
      versionId: active?.id,
      revision: Number(active?.revision ?? 0),
      status,
      operations: [],
    };
    if (!active && versions.some((version) => version.status === "archived")) {
      return {
        department,
        target,
        unavailable: {
          label: "בסל המחזור",
          detail: "אפשר לשחזר את הסידור מעמוד המחלקה.",
        },
      };
    }

    const assignments = [...working.values()];
    const configured =
      data.coverage_requirements.some(
        (row) => row.department_id === departmentId,
      ) ||
      data.shift_templates.some(
        (row) =>
          row.department_id === departmentId &&
          row.confirmed &&
          row.start_time &&
          row.end_time,
      );
    const open = assignments.some(
      (shift) => shift.version_id === active?.id && !shift.employee_id,
    );
    if (!configured && !open) {
      return {
        department,
        target,
        unavailable: {
          label: "שעות טרם הוגדרו",
          detail: "יש להגדיר דרישות איוש או לאמת שעות משמרת בהגדרות המחלקה.",
        },
      };
    }
    try {
      target.operations = planWeek(
        {
          ...data,
          shift_assignments: assignments,
          schedule_versions:
            status === "published"
              ? data.schedule_versions.map((version) =>
                  version.id === active?.id
                    ? { ...version, status: "draft" }
                    : version,
                )
              : data.schedule_versions,
        },
        week,
        configured ? "generate" : "fill",
        departmentId,
      );
    } catch (error) {
      return {
        department,
        target,
        unavailable: { label: "דורש בדיקה", detail: (error as Error).message },
      };
    }
    for (const operation of target.operations)
      working.set(operation.id, operation);
    const unavailable = target.operations.length
      ? undefined
      : open
        ? {
            label: "משמרות נותרו פנויות",
            detail: "לא נמצאו עובדים זמינים ומתאימים למשמרות הפנויות.",
          }
        : {
            label: "הסידור מלא",
            detail: "כל המשמרות הנדרשות כבר משובצות.",
          };
    return { department, target, unavailable };
  });
}

export function copyPreviousWeek(
  data: Data,
  week: string,
  departmentId = data.departments[0]?.id,
): Operation[] {
  const scope = (id: unknown) => !departmentId || id === departmentId;
  const target = data.schedule_versions.find(
    (v) =>
      v.week_start === week &&
      v.status !== "archived" &&
      scope(v.department_id),
  );
  if (target && target.status !== "draft")
    throw new Error("יש לפתוח את הסידור לעריכה תחילה");
  if (data.shift_assignments.some((a) => a.version_id === target?.id))
    throw new Error("העתקה אפשרית לשבוע ריק בלבד. הסידור הקיים לא השתנה");
  const source = data.schedule_versions.find(
    (v) =>
      v.week_start === addDays(week, -7) &&
      v.status !== "archived" &&
      scope(v.department_id),
  );
  const shifts = data.shift_assignments
    .filter((a) => a.version_id === source?.id)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!shifts.length) throw new Error("אין סידור בשבוע הקודם להעתקה");
  if (shifts.length > 100) throw new Error("אפשר להעתיק עד 100 משמרות בפעולה");
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const working = data.shift_assignments.slice();
  return shifts.map((shift) => {
    const next = {
      ...shift,
      id: crypto.randomUUID(),
      version_id: target?.id || "",
      ...interval(
        addDays(localDate(shift.starts_at), 7),
        clock(shift.starts_at),
        clock(shift.ends_at),
      ),
    };
    if (next.employee_id && !canAssign(data, next, next.employee_id, working))
      next.employee_id = null;
    working.push(next);
    return { ...next, kind: "create" };
  });
}
