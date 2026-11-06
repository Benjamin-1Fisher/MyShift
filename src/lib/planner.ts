import {
  addDays,
  duration,
  interval,
  localDate,
  overlaps,
  type Assignment,
  type Data,
  type Operation,
} from "./domain";

export function canAssign(
  data: Data,
  shift: Assignment,
  employeeId: string,
  all = data.shift_assignments,
) {
  if (!data.employees.some((e) => e.id === employeeId && e.active))
    return false;
  if (
    !data.employee_departments.some(
      (m) =>
        m.employee_id === employeeId &&
        m.department_id === shift.department_id &&
        m.role_id === shift.role_id,
    )
  )
    return false;
  const windows = data.availability.filter((w) => w.employee_id === employeeId);
  if (
    windows.some(
      (w) =>
        w.kind !== "available" && overlaps(shift, w as unknown as Assignment),
    )
  )
    return false;
  const allowed = windows.filter((w) => w.kind === "available");
  if (
    allowed.length &&
    !allowed.some(
      (w) =>
        Date.parse(String(w.starts_at)) <= Date.parse(shift.starts_at) &&
        Date.parse(String(w.ends_at)) >= Date.parse(shift.ends_at),
    )
  )
    return false;
  const rest = Number(data.settings[0]?.min_rest_hours ?? 0);
  return !all.some(
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
}

// Deterministic staffing rules, independent of AI. Existing assignments are never replaced.
export function planWeek(
  data: Data,
  week: string,
  mode: "generate" | "fill" | "open",
) {
  const version = data.schedule_versions.find((v) => v.week_start === week);
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
      requirements.set(key, { shift, count: (previous?.count || 0) + count });
    };
    if (data.coverage_requirements.length) {
      for (const r of data.coverage_requirements)
        add(
          String(r.department_id),
          String(r.site_id),
          String(r.role_id),
          addDays(week, Number(r.weekday)),
          String(r.start_time).slice(0, 5),
          String(r.end_time).slice(0, 5),
          Number(r.required_count),
        );
    } else {
      if (!data.sites.length || !data.roles.length)
        throw new Error("יש להוסיף אתר ותפקיד לפני יצירת שבוע");
      for (const role of data.roles) {
        const templates = data.shift_templates.filter(
          (t) =>
            t.department_id === role.department_id &&
            t.confirmed &&
            t.start_time &&
            t.end_time,
        );
        const hours = templates.length
          ? templates
          : [{ start_time: "07:00", end_time: "15:00" }];
        for (let day = 0; day < 7; day++)
          for (const t of hours)
            add(
              String(role.department_id),
              data.sites[0].id,
              role.id,
              addDays(week, day),
              String(t.start_time).slice(0, 5),
              String(t.end_time).slice(0, 5),
              1,
            );
      }
    }
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
  const operations: Operation[] = [];
  const targets = (
    mode === "open"
      ? created
      : existing.filter((a) => !a.employee_id).concat(created)
  ).sort(
    (a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      a.id.localeCompare(b.id),
  );
  for (const shift of targets) {
    const current = working.find((a) => a.id === shift.id)!;
    if (mode !== "open") {
      const hours = (id: string) =>
        working
          .filter(
            (a) =>
              a.employee_id === id &&
              localDate(a.starts_at) >= week &&
              localDate(a.starts_at) <= addDays(week, 6),
          )
          .reduce((n, a) => n + duration(a), 0);
      current.employee_id =
        data.employees
          .filter((e) => canAssign(data, current, e.id, working))
          .sort(
            (a, b) =>
              hours(a.id) - hours(b.id) ||
              String(a.name).localeCompare(String(b.name), "he"),
          )[0]?.id || null;
    }
    if (created.some((a) => a.id === shift.id))
      operations.push({ ...current, kind: "create" });
    else if (current.employee_id)
      operations.push({ ...current, kind: "update" });
  }
  if (operations.length > 100)
    throw new Error("עד 100 שינויים בפעולה. השתמשו במסנן או פצלו את השבוע");
  return operations;
}

export function copyPreviousWeek(data: Data, week: string): Operation[] {
  const target = data.schedule_versions.find((v) => v.week_start === week);
  if (target && target.status !== "draft")
    throw new Error("יש לפתוח את הסידור לעריכה תחילה");
  if (data.shift_assignments.some((a) => a.version_id === target?.id))
    throw new Error("העתקה אפשרית לשבוע ריק בלבד. הסידור הקיים לא השתנה");
  const source = data.schedule_versions.find(
    (v) => v.week_start === addDays(week, -7) && v.status !== "archived",
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
