import { z } from "zod";
import { adminSchema } from "./admin-schema";
import { canAssign } from "./planner";
import { isWeeklyAvailable } from "./weekly-availability";
import { absenceInterval, isAbsence } from "./absences";
import { DEMO_KEY, DEMO_RECEIPTS_KEY } from "./demo-storage";
import {
  weeklyScheduleSchema,
  type PersonalSchedule,
  type PublicationReview,
  type WeeklyScheduleRequest,
} from "./weekly-schedule";
import {
  publicationChanges,
  scheduleSnapshot,
  type PublicationSnapshot,
} from "./schedule-notifications";
import {
  addDays,
  availabilityWindows,
  duration,
  interval,
  localDate,
  operationSchema,
  overlaps,
  sunday,
  tables,
  type Assignment,
  type Data,
  type Operation,
  type Row,
} from "./domain";

// This store is only called from the /demo client. Production never reads it.
export { DEMO_KEY } from "./demo-storage";
export const DEMO_ADMIN = "10000000-0000-4000-8000-000000000001";
const uid = () => crypto.randomUUID();
const fixed = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Change = { before: Assignment | null; after: Assignment | null };
type Pending = {
  id: string;
  version: string;
  revision: number;
  changes: Change[];
};
type Store = {
  schema: 1;
  resetToken?: string;
  data: Data;
  pending: Pending[];
  departmentsUpgraded?: boolean;
  sampleSchedulesAdded?: boolean;
  publications?: Record<string, PublicationSnapshot>;
  withdrawnPublications?: string[];
};
const rowSchema = z.object({ id: z.string() }).catchall(z.unknown());
const dataSchema = z.object(
  Object.fromEntries(tables.map((t) => [t, z.array(rowSchema)])),
);

export function seedDemo(): Store {
  const data = Object.fromEntries(
    tables.map((t) => [t, []]),
  ) as unknown as Data;
  const week = sunday();
  data.profiles = [{ id: DEMO_ADMIN, name: "מנהל ההדגמה", role: "admin" }];
  data.departments = [
    { id: fixed(1), name: "אחמ״שים", color: "#7360d6" },
    { id: fixed(2), name: "סיירים", color: "#149c8e" },
  ];
  data.sites = [
    { id: fixed(3), name: "מתחם מרכז" },
    { id: fixed(4), name: "מתחם צפון" },
  ];
  data.roles = [
    { id: fixed(5), department_id: fixed(1), name: "אחמ״ש" },
    { id: fixed(6), department_id: fixed(2), name: "סייר" },
  ];
  const names = [
    "דניאל לוי",
    "נועה כהן",
    "איתי מזרחי",
    "מאיה ישראלי",
    "עומר ברק",
    "שירה רון",
    "יובל הדר",
    "תמר גולן",
  ];
  names.forEach((name, i) => {
    const employee = { id: fixed(20 + i), name, active: true, user_id: null };
    data.employees.push(employee);
    data.employee_departments.push({
      id: fixed(40 + i),
      employee_id: employee.id,
      department_id: fixed(i < 3 ? 1 : 2),
      role_id: fixed(i < 3 ? 5 : 6),
    });
  });
  data.settings = [{ id: fixed(7), min_rest_hours: 8, max_shift_hours: 12 }];
  data.schedule_versions = [
    { id: fixed(8), week_start: week, status: "draft", revision: 0 },
    {
      id: fixed(9),
      week_start: addDays(week, -7),
      status: "published",
      revision: 1,
    },
  ];
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < 3; slot++) {
      const dep = slot === 0 ? 1 : 2;
      const index = slot === 0 ? day % 3 : 3 + ((day + slot) % 5);
      const hours = slot === 2 ? ["15:00", "23:00"] : ["07:00", "15:00"];
      data.shift_assignments.push({
        id: fixed(100 + day * 3 + slot),
        version_id: fixed(8),
        department_id: fixed(dep),
        role_id: fixed(dep === 1 ? 5 : 6),
        site_id: fixed(slot === 2 ? 4 : 3),
        employee_id: day === 4 && slot === 2 ? null : fixed(20 + index),
        ...interval(addDays(week, day), hours[0], hours[1]),
      });
      data.coverage_requirements.push({
        id: fixed(200 + day * 3 + slot),
        department_id: fixed(dep),
        role_id: fixed(dep === 1 ? 5 : 6),
        site_id: fixed(slot === 2 ? 4 : 3),
        weekday: day,
        start_time: hours[0],
        end_time: hours[1],
        required_count: 1,
      });
    }
    data.shift_assignments.push({
      id: fixed(300 + day),
      version_id: fixed(9),
      department_id: fixed(1),
      role_id: fixed(5),
      site_id: fixed(3),
      employee_id: fixed(20 + (day % 3)),
      ...interval(addDays(week, day - 7), "07:00", "15:00"),
    });
  }
  for (const dep of data.departments) {
    for (const [index, name, start, end] of [
      [0, "בוקר", "07:00", "15:00"],
      [1, "ערב", "15:00", "23:00"],
      [2, "לילה", "23:00", "07:00"],
    ] as const) {
      data.shift_templates.push({
        id: fixed(Number(dep.id.slice(-1)) * 10 + 400 + index),
        department_id: dep.id,
        name,
        start_time: start,
        end_time: end,
        confirmed: true,
      });
    }
  }
  data.notifications = [
    {
      id: fixed(500),
      user_id: DEMO_ADMIN,
      message:
        "ברוכים הבאים להדגמה. אפשר להוסיף עובד, לשבץ ולפרסם סידור מקומי.",
      read: false,
      created_at: new Date().toISOString(),
    },
  ];
  const store = upgradeDemo({ schema: 1, data, pending: [] });
  addSampleSchedules(store);
  return preparePublications(store);
}

function preparePublications(store: Store): Store {
  store.publications ||= {};
  store.withdrawnPublications ??= store.data.schedule_versions
    .filter((v) => {
      if (v.status === "published" || !store.publications?.[v.id]) return false;
      if (v.status === "archived") return true;
      const lastAction = store.data.audit_logs.find(
        (entry) => (entry.after_data as Row | undefined)?.id === v.id,
      );
      return lastAction?.action !== "פתיחת סידור לעריכה";
    })
    .map((v) => v.id);
  for (const version of store.data.schedule_versions.filter(
    (v) => v.status === "published",
  )) {
    if (store.publications[version.id]) continue;
    const snapshot = scheduleSnapshot(store.data, version.id);
    store.publications[version.id] = snapshot;
    // Preserve real publication dates from the existing activity log. Welcome
    // messages and draft edits are not converted into schedule notifications.
    const audit = store.data.audit_logs.find(
      (a) =>
        a.action === "פרסום סידור מקומי" &&
        (a.after_data as Row | undefined)?.id === version.id,
    );
    if (
      audit &&
      !store.data.notifications.some(
        (n) => n.version_id === version.id && n.kind,
      )
    )
      store.data.notifications.push({
        id: uid(),
        user_id: DEMO_ADMIN,
        kind: "schedule_published",
        message: "סידור פורסם",
        version_id: version.id,
        department_id: version.department_id,
        week_start: version.week_start,
        details: publicationChanges([], snapshot),
        created_at: audit.created_at,
        read: true,
      });
  }
  return store;
}

function notifyPublication(
  store: Store,
  version: Row,
  previousStatus: unknown,
) {
  if (previousStatus === version.status) return;
  const snapshot = scheduleSnapshot(store.data, version.id);
  const current = store.publications?.[version.id];
  const previous = latestPublication(store, version)?.snapshot;
  const withdrawn = store.withdrawnPublications!.includes(version.id);
  const details: Record<string, unknown> = publicationChanges(
    previous || [],
    snapshot,
  );
  let kind: string;
  if (version.status === "published") {
    kind =
      previous &&
      Number(details.added) +
        Number(details.removed) +
        Number(details.updated) >
        0
        ? "schedule_changed"
        : "schedule_published";
    store.publications ||= {};
    store.publications[version.id] = snapshot;
    store.withdrawnPublications = store.withdrawnPublications!.filter((id) => id !== version.id);
    if (current && !withdrawn && JSON.stringify(current) === JSON.stringify(snapshot))
      return;
  } else if (version.status === "archived" && current && !withdrawn) {
    store.withdrawnPublications!.push(version.id);
    kind = "schedule_withdrawn";
    Object.assign(details, publicationChanges(current, []));
    details.reason = "archived";
  } else return;
  store.data.notifications.unshift({
    id: uid(),
    user_id: DEMO_ADMIN,
    kind,
    message:
      kind === "schedule_published" ? "סידור פורסם" : "שינוי בסידור שפורסם",
    version_id: version.id,
    department_id: version.department_id,
    week_start: version.week_start,
    details,
    read: false,
    created_at: new Date().toISOString(),
  });
}

const sampleDepartments = [
  [1, "אחמ״שים", "#7360d6", ["גלי לביא", "אבנר זמיר"]],
  [2, "סיירים", "#149c8e", ["רועי שקד", "הילה ארז"]],
  [10, "קבלה", "#3979bb", ["ליאור פרץ", "מיכל סער"]],
  [11, "חניונים", "#b27724", ["אורי נבון", "דנה שביט"]],
] as const;

function upgradeDemoEmployeeNames(data: Data) {
  for (const [index, department, , names] of sampleDepartments) {
    names.forEach((name, offset) => {
      const id = fixed(index * 10 + 700 + offset);
      const employee = data.employees.find((row) => row.id === id);
      if (employee?.name === `${department} — עובד לדוגמה ${offset + 1}`)
        employee.name = name;
    });
  }
}

// Additive upgrade: keep the same storage key, employees, shifts, archives and history.
export function upgradeDemo(store: Store): Store {
  const data = store.data;
  data.manager_departments ||= [];
  if (store.departmentsUpgraded) return store;
  for (const [index, name, color, employeeNames] of sampleDepartments) {
    if (data.departments.some((d) => d.id === fixed(index) || d.name === name))
      continue;
    const department_id = fixed(index);
    data.departments.push({ id: department_id, name, color, active: true });
    const role_id = fixed(index + 600);
    data.roles.push({ id: role_id, department_id, name });
    // Unknown working hours remain empty until a manager explicitly configures them.
    data.shift_templates.push({
      id: fixed(index + 620),
      department_id,
      name: "שעות להגדרה",
      start_time: null,
      end_time: null,
      confirmed: false,
    });
    for (let i = 0; i < 2; i++) {
      const employee_id = fixed(index * 10 + 700 + i);
      data.employees.push({
        id: employee_id,
        name: employeeNames[i],
        active: true,
      });
      data.employee_departments.push({
        id: uid(),
        employee_id,
        department_id,
        role_id,
      });
    }
  }
  for (const version of data.schedule_versions.slice()) {
    if (version.department_id) continue;
    const deps = [
      ...new Set(
        data.shift_assignments
          .filter((a) => a.version_id === version.id)
          .map((a) => a.department_id),
      ),
    ];
    if (!deps.length) deps.push(data.departments[0].id);
    for (const [i, department_id] of deps.entries()) {
      const scoped = i === 0 ? version : { ...version, id: uid() };
      scoped.department_id = department_id;
      if (i) {
        data.schedule_versions.push(scoped);
        for (const a of data.shift_assignments)
          if (a.version_id === version.id && a.department_id === department_id)
            a.version_id = scoped.id;
      }
    }
    store.pending = store.pending.filter((r) => r.version !== version.id);
  }
  store.departmentsUpgraded = true;
  return store;
}

// Fill the week the demo opens on, once per browser. Keep user-created and
// archived schedules, and leave scheduling templates under the manager's control.
function addSampleSchedules(store: Store) {
  if (store.sampleSchedulesAdded) return;
  const { data } = store;
  const currentWeek = sunday();
  const weeks = data.schedule_versions.map((version) =>
    String(version.week_start),
  );
  const week = weeks.includes(currentWeek) ? currentWeek : weeks.sort().at(-1);
  store.sampleSchedulesAdded = true;
  if (!week) return;

  for (const [number, siteNumber, times] of [
    [
      10,
      3,
      [
        ["08:00", "14:00"],
        ["14:00", "20:00"],
      ],
    ],
    [
      11,
      4,
      [
        ["06:00", "14:00"],
        ["14:00", "22:00"],
      ],
    ],
  ] as const) {
    const department_id = fixed(number);
    const role_id = fixed(number + 600);
    const site_id = fixed(siteNumber);
    if (
      !data.departments.some(
        (row) => row.id === department_id && row.active !== false,
      ) ||
      !data.roles.some(
        (row) => row.id === role_id && row.department_id === department_id,
      ) ||
      !data.sites.some((row) => row.id === site_id) ||
      data.schedule_versions.some(
        (row) => row.department_id === department_id && row.week_start === week,
      )
    )
      continue;

    const version_id = uid();
    const shifts: Assignment[] = [];
    for (let day = 0; day < 7; day++) {
      for (const [slot, [start, end]] of times.entries()) {
        const shift: Assignment = {
          id: uid(),
          version_id,
          department_id,
          role_id,
          site_id,
          employee_id: null,
          ...interval(addDays(week, day), start, end),
        };
        if (duration(shift) > Number(data.settings[0]?.max_shift_hours ?? 12))
          continue;
        const employee = fixed(number * 10 + 700 + slot);
        if (
          canAssign(data, shift, employee, [
            ...data.shift_assignments,
            ...shifts,
          ])
        )
          shift.employee_id = employee;
        shifts.push(shift);
      }
    }
    if (!shifts.length) continue;
    data.schedule_versions.push({
      id: version_id,
      department_id,
      week_start: week,
      status: "draft",
      revision: 0,
    });
    data.shift_assignments.push(...shifts);
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(store));
  } catch {
    throw new Error(
      "לא ניתן לשמור בדפדפן. בדקו שהאחסון המקומי מותר ושיש מקום פנוי. השינוי לא נשמר.",
    );
  }
}

export function resetDemo() {
  const fresh = seedDemo();
  fresh.resetToken = uid();
  write(fresh);
  localStorage.removeItem(DEMO_RECEIPTS_KEY);
}
function read(): Store {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DEMO_KEY);
  } catch {
    throw new Error(
      "האחסון המקומי חסום. יש לאפשר אחסון בדפדפן כדי להפעיל את ההדגמה.",
    );
  }
  if (!raw) {
    const fresh = seedDemo();
    write(fresh);
    return fresh;
  }
  try {
    const store = JSON.parse(raw);
    if (store.schema !== 1 || !Array.isArray(store.pending)) throw new Error();
    store.data.manager_departments ||= [];
    dataSchema.parse(store.data);
    store.data.shift_assignments.forEach((a: Assignment) =>
      operationSchema.parse({ ...a, kind: "update" }),
    );
    const before = JSON.stringify(store);
    upgradeDemo(store);
    upgradeDemoEmployeeNames(store.data);
    addSampleSchedules(store);
    preparePublications(store);
    if (JSON.stringify(store) !== before) write(store);
    return store;
  } catch {
    throw new Error(
      "נתוני ההדגמה המקומיים אינם תקינים. הם לא נמחקו. אפשר לפתוח את ההדגמה בפרופיל דפדפן אחר.",
    );
  }
}
export function loadDemo(): Data {
  return read().data;
}
export function loadDemoWorkspace() {
  const store = read();
  const versions = store.data.schedule_versions.filter(
    (v) => v.status !== "archived" && store.publications?.[v.id] &&
      !store.withdrawnPublications?.includes(v.id),
  );
  const personal: PersonalSchedule = {
    schedule_versions: versions.map((v) => ({ ...v, status: "published" })),
    shift_assignments: versions.flatMap((v) =>
      store.publications![v.id].map((shift) => ({ ...shift, version_id: v.id })),
    ),
  };
  return { data: store.data, personal };
}
function upsert(rows: Row[], value: Record<string, unknown>) {
  const row = { ...value, id: String(value.id || uid()) };
  const index = rows.findIndex((r) => r.id === row.id);
  if (index < 0) rows.push(row);
  else rows[index] = { ...rows[index], ...row };
  return row.id;
}
function audit(
  store: Store,
  action: string,
  before: unknown = null,
  after: unknown = null,
) {
  store.data.audit_logs.unshift({
    id: uid(),
    actor_id: DEMO_ADMIN,
    action,
    entity: action,
    table_name: "demo",
    before_data: before,
    after_data: after,
    created_at: new Date().toISOString(),
  });
}
function validate(data: Data, assignments: Assignment[], version: Row) {
  const week = String(version.week_start);
  for (const a of assignments.filter((a) => a.version_id === version.id)) {
    operationSchema.parse({ ...a, kind: "update" });
    if (
      localDate(a.starts_at) < week ||
      localDate(a.starts_at) > addDays(week, 6)
    )
      throw new Error("תאריך המשמרת חייב להיות בשבוע הנבחר");
    if (
      !data.departments.some((d) => d.id === a.department_id) ||
      !data.sites.some((s) => s.id === a.site_id) ||
      !data.roles.some(
        (r) => r.id === a.role_id && r.department_id === a.department_id,
      )
    )
      throw new Error("יש לבחור מחלקה, אתר ותפקיד תואמים");
    if (duration(a) > Number(data.settings[0]?.max_shift_hours ?? 12))
      throw new Error("המשמרת ארוכה מהמותר בהגדרות");
    if (a.department_id !== version.department_id)
      throw new Error("המשמרת אינה שייכת למחלקה של הסידור");
    if (!a.employee_id) continue;
    if (!data.employees.some((e) => e.id === a.employee_id && e.active))
      throw new Error("העובד אינו פעיל");
    if (
      !data.employee_departments.some(
        (m) =>
          m.employee_id === a.employee_id &&
          m.department_id === a.department_id &&
          m.role_id === a.role_id,
      )
    )
      throw new Error("לעובד אין הכשרה לתפקיד ולמחלקה שנבחרו");
    for (const other of assignments.filter(
      (b) =>
        b.id !== a.id &&
        b.employee_id === a.employee_id &&
        !data.schedule_versions.some(
          (v) => v.id === b.version_id && v.status === "archived",
        ),
    )) {
      if (overlaps(a, other))
        throw new Error("לעובד יש משמרת חופפת. יש לבחור עובד או שעות אחרות");
      const gap =
        Math.max(
          Date.parse(a.starts_at) - Date.parse(other.ends_at),
          Date.parse(other.starts_at) - Date.parse(a.ends_at),
        ) / 3600000;
      if (gap < Number(data.settings[0]?.min_rest_hours ?? 0))
        throw new Error("לא נשמר זמן המנוחה המוגדר בין המשמרות");
    }
    if (!isWeeklyAvailable(data, a, a.employee_id))
      throw new Error("המשמרת מחוץ לזמינות הקבועה של העובד");
    const windows = availabilityWindows(data, a.employee_id, a.starts_at);
    if (
      windows.some(
        (w) =>
          w.kind !== "available" && overlaps(a, w as unknown as Assignment),
      )
    )
      throw new Error("העובד אינו זמין בשעות שנבחרו");
    const available = windows.filter((w) => w.kind === "available");
    if (
      available.length &&
      !available.some(
        (w) =>
          Date.parse(String(w.starts_at)) <= Date.parse(a.starts_at) &&
          Date.parse(String(w.ends_at)) >= Date.parse(a.ends_at),
      )
    )
      throw new Error("המשמרת מחוץ לזמינות העובד");
  }
}
function apply(assignments: Assignment[], changes: Change[]) {
  return assignments
    .filter((a) => !changes.some((c) => c.before?.id === a.id))
    .concat(changes.flatMap((c) => (c.after ? [c.after] : [])));
}

function operationChanges(data: Data, version: Row, operations: Operation[], additive = false) {
  const seen = new Set<string>();
  return operations.map((op): Change => {
    const before = op.kind === "create" ? null : data.shift_assignments.find(
      (shift) => shift.id === op.id && shift.version_id === version.id,
    );
    if (op.kind !== "create") {
      if (!before || seen.has(op.id)) throw new Error("המשמרת השתנתה. רעננו ונסו שוב");
      seen.add(op.id);
    }
    if (additive && op.kind !== "create" && (
      op.kind === "delete" || before?.employee_id || !op.employee_id ||
      before?.site_id !== op.site_id || before.role_id !== op.role_id ||
      Date.parse(before.starts_at) !== Date.parse(op.starts_at) ||
      Date.parse(before.ends_at) !== Date.parse(op.ends_at)
    )) throw new Error("תכנון שבועי יכול רק להוסיף משמרות ולמלא משמרות פנויות");
    if (op.kind !== "delete" && op.department_id !== version.department_id)
      throw new Error("המשמרת אינה שייכת למחלקה של הסידור");
    if (op.kind === "delete") return { before: before!, after: null };
    const { kind, ...fields } = op;
    return {
      before: before || null,
      after: { ...fields, id: kind === "create" ? uid() : op.id, version_id: version.id },
    };
  });
}

function latestPublication(store: Store, version: Row) {
  const latest = store.data.notifications.find((notice) =>
    notice.week_start === version.week_start && notice.department_id === version.department_id &&
    (notice.kind === "schedule_published" || notice.kind === "schedule_changed"),
  );
  const id = typeof latest?.version_id === "string" ? latest.version_id : version.id;
  const snapshot = store.publications?.[id];
  return snapshot ? { id, snapshot } : undefined;
}

function validatePublication(store: Store, version: Row, selected: Set<string>) {
  const { data } = store;
  validate(data, data.shift_assignments, version);
  const rest = Number(data.settings[0]?.min_rest_hours ?? 0) * 3600000;
  const stillVisible = data.schedule_versions.filter((other) =>
    other.status === "draft" && !selected.has(other.id) && !store.withdrawnPublications?.includes(other.id),
  ).flatMap((other) => store.publications?.[other.id] || []);
  if (data.shift_assignments.some((shift) => shift.version_id === version.id && shift.employee_id &&
    stillVisible.some((other) => other.employee_id === shift.employee_id &&
      Date.parse(other.starts_at) < Date.parse(shift.ends_at) + rest &&
      Date.parse(other.ends_at) > Date.parse(shift.starts_at) - rest,
    ))) throw new Error("שיבוץ מתנגש עם סידור אחר שעדיין מוצג לעובדים. בדקו אם צריך לפרסם גם את העדכון למחלקה השנייה");
}

function reviewPublication(store: Store, version: Row, selected: Set<string>): PublicationReview | null {
  const previous = latestPublication(store, version);
  const before = previous?.snapshot || [];
  const after = scheduleSnapshot(store.data, version.id);
  if (!previous && !after.length) return null;
  const old = new Map(before.map((shift) => [shift.id, shift]));
  const current = new Map(after.map((shift) => [shift.id, shift]));
  const changes = [...new Set([...old.keys(), ...current.keys()])].flatMap((id) => {
    const from = old.get(id);
    const to = current.get(id);
    if (JSON.stringify(from) === JSON.stringify(to)) return [];
    return [{
      before: from ? { ...from, version_id: previous?.id || version.id } : null,
      after: to ? { ...to, version_id: version.id } : null,
    }];
  });
  let error = null;
  try {
    validatePublication(store, version, selected);
  } catch (cause) {
    error = (cause as Error).message;
  }
  return {
    department_id: String(version.department_id), version_id: version.id,
    revision: Number(version.revision), first_publication: !previous,
    open_count: after.filter((shift) => !shift.employee_id).length, changes, error,
  };
}

function runWeeklyCommand(store: Store, input: WeeklyScheduleRequest) {
  const { data } = store;
  const { action, week } = input;
  if (sunday(new Date(week + "T12:00:00Z")) !== week)
    throw new Error("יש לבחור תחילת שבוע תקינה");
  const activeDepartments = new Set(
    data.departments.filter((department) => department.active !== false).map(({ id }) => id),
  );
  const versions = data.schedule_versions.filter((version) => version.week_start === week);
  if (action === "review_weekly_publication") {
    const drafts = versions.filter((version) =>
      version.status === "draft" && activeDepartments.has(String(version.department_id)));
    const selected = new Set(drafts.map((version) => version.id));
    return drafts.flatMap((version) => reviewPublication(store, version, selected) || []);
  }
  const selected = new Set(input.targets.flatMap((target) => target.version_id || []));
  const seen = new Set<string>();
  const result = input.targets.map((target) => {
    const departmentId = target.department_id;
    if (!activeDepartments.has(departmentId) || seen.has(departmentId))
      throw new Error("בחירת המחלקות אינה תקינה");
    seen.add(departmentId);
    let version = versions.find((v) => v.department_id === departmentId && v.status !== "archived");
    const expectedStatus = "status" in target ? target.status : "draft";
    if ((version?.id || null) !== target.version_id ||
      Number(version?.revision || 0) !== target.revision ||
      (version?.status || null) !== expectedStatus ||
      (!version && versions.some((v) => v.department_id === departmentId))) {
      throw new Error("הסידור השתנה. יש לפתוח תצוגה מקדימה חדשה");
    }
    if (!version) {
      version = { id: uid(), week_start: week, department_id: departmentId,
        status: "draft", revision: 0, created_at: new Date().toISOString() };
      data.schedule_versions.push(version);
    }
    const before = { ...version };
    if (!("operations" in target)) {
      const review = reviewPublication(store, version, selected);
      if (!review || review.error) throw new Error(review?.error || "אין טיוטה לפרסום");
      version.status = "published";
      notifyPublication(store, version, before.status);
      audit(store, "פרסום סידור מקומי", before, version);
    }
    let changes: Change[] = [];
    if ("operations" in target) {
      version.status = "draft";
      changes = operationChanges(data, version, target.operations, action === "apply_weekly_plan");
      data.shift_assignments = apply(data.shift_assignments, changes);
      validate(data, data.shift_assignments, version);
      if ("restore_published" in target && target.restore_published) {
        const previous = store.publications?.[version.id];
        const snapshot = scheduleSnapshot(data, version.id);
        if (!previous || store.withdrawnPublications?.includes(version.id) ||
          JSON.stringify(previous) !== JSON.stringify(snapshot))
          throw new Error("לא ניתן לשחזר את מצב הפרסום הקודם");
        version.status = "published";
      }
      changes.forEach((change) =>
        audit(store, "שינוי משמרת בהדגמה", change.before, change.after),
      );
    }
    version.revision = Number(version.revision) + 1;
    store.pending = store.pending.filter((p) => p.version !== version.id);
    return { department_id: departmentId, version_id: version.id, revision: Number(version.revision), changes };
  });
  write(store);
  return result;
}

export async function demoCommand(
  url: string,
  body: unknown,
): Promise<unknown> {
  if (url === "/api/ai") throw new Error("עוזר AI — בקרוב");
  const store = read(),
    data = store.data;
  if (url === "/api/admin") {
    const { kind, data: value } = adminSchema.parse(body);
    switch (kind) {
      case "absence": {
        if (!data.employees.some((e) => e.id === value.employee_id))
          throw new Error("העובד לא נמצא");
        if (
          value.id &&
          !data.availability.some(
            (a) =>
              a.id === value.id &&
              a.employee_id === value.employee_id &&
              isAbsence(a),
          )
        )
          throw new Error("דיווח ההיעדרות לא נמצא");
        upsert(data.availability, {
          id: value.id || uid(),
          employee_id: value.employee_id,
          kind: "leave",
          absence_reason: value.absence_reason,
          ...absenceInterval(value.starts_on, value.ends_on),
        });
        break;
      }
      case "cancel_absence": {
        const previous = data.availability.find(
          (a) => a.id === value.id && isAbsence(a),
        );
        if (!previous) throw new Error("דיווח ההיעדרות לא נמצא או כבר בוטל");
        audit(store, "ביטול היעדרות", previous, null);
        data.availability = data.availability.filter((a) => a.id !== value.id);
        write(store);
        return { ok: true };
      }
      case "employee": {
        const { department_id, role_id, ...employee } = value;
        const id = upsert(data.employees, employee);
        if (department_id && role_id) {
          if (
            !data.roles.some(
              (r) => r.id === role_id && r.department_id === department_id,
            )
          )
            throw new Error("התפקיד אינו שייך למחלקה שנבחרה");
          if (
            !data.employee_departments.some(
              (m) =>
                m.employee_id === id &&
                m.department_id === department_id &&
                m.role_id === role_id,
            )
          )
            data.employee_departments.push({
              id: uid(),
              employee_id: id,
              department_id,
              role_id,
            });
        }
        break;
      }
      case "department":
        upsert(data.departments, value);
        break;
      case "site":
        upsert(data.sites, value);
        break;
      case "role":
        upsert(data.roles, value);
        break;
      case "template":
        upsert(data.shift_templates, value);
        break;
      case "availability":
        upsert(data.availability, value);
        break;
      case "coverage":
        upsert(data.coverage_requirements, value);
        break;
      case "settings":
        data.settings = [{ ...data.settings[0], ...value }];
        break;
      case "membership": {
        if (
          !data.roles.some(
            (r) =>
              r.id === value.role_id && r.department_id === value.department_id,
          )
        )
          throw new Error("התפקיד אינו שייך למחלקה שנבחרה");
        if (
          !data.employee_departments.some(
            (m) =>
              m.employee_id === value.employee_id &&
              m.department_id === value.department_id &&
              m.role_id === value.role_id,
          )
        )
          data.employee_departments.push({ id: uid(), ...value });
        break;
      }
      case "notification":
        data.notifications = data.notifications.map((n) =>
          n.id === value.id ? { ...n, read: true } : n,
        );
        break;
      default:
        throw new Error(
          "ניהול חשבונות והרשאות ארגוניות זמין רק במערכת המחוברת. בהדגמה אפשר לעבור לתצוגת עובד בכפתור למעלה.",
        );
    }
    audit(store, `שמירה מקומית: ${kind}`, null, value);
    write(store);
    return { ok: true };
  }
  if (url !== "/api/change") throw new Error("פעולה אינה זמינה בהדגמה");
  const weekly = weeklyScheduleSchema.safeParse(body);
  if (weekly.success) return runWeeklyCommand(store, weekly.data);
  const input = z
    .object({
      action: z.enum([
        "create",
        "publish",
        "reopen",
        "preview",
        "confirm",
        "cancel",
        "archive",
        "restore",
      ]),
      week: z.iso.date().optional(),
      department_id: z.uuid().optional(),
      revision: z.number().int().optional(),
      active_id: z.uuid().nullable().optional(),
      active_revision: z.number().int().nullable().optional(),
      version: z.uuid().optional(),
      id: z.uuid().optional(),
      operations: z.array(operationSchema).min(1).max(100).optional(),
    })
    .parse(body);
  let result: unknown = { ok: true };
  if (input.action === "archive" || input.action === "restore") {
    const version = data.schedule_versions.find(
      (v) => v.id === input.id && v.week_start === input.week,
    );
    const active = data.schedule_versions.find(
      (v) =>
        v.week_start === input.week &&
        v.department_id === (input.department_id || data.departments[0]?.id) &&
        v.status !== "archived",
    );
    if (
      !version ||
      version.department_id !==
        (input.department_id || data.departments[0]?.id) ||
      version.revision !== input.revision ||
      (active?.id || null) !== input.active_id ||
      (active ? Number(active.revision) : null) !== input.active_revision
    )
      throw new Error("הסידור השתנה. רעננו ונסו שוב");
    if ((input.action === "archive") === (version.status === "archived"))
      throw new Error("מצב הסידור כבר השתנה");
    const before = { ...version };
    if (input.action === "restore" && active) {
      const beforeActive = { ...active };
      active.status = "archived";
      active.archived_at = new Date().toISOString();
      active.revision = Number(active.revision) + 1;
      notifyPublication(store, active, beforeActive.status);
      store.pending = store.pending.filter((p) => p.version !== active.id);
      audit(store, "שמירת הסידור הנוכחי לפני שחזור", beforeActive, active);
    }
    version.status = input.action === "archive" ? "archived" : "draft";
    version.archived_at =
      input.action === "archive" ? new Date().toISOString() : null;
    if (input.action === "restore")
      validate(data, data.shift_assignments, version);
    version.revision = Number(version.revision) + 1;
    notifyPublication(store, version, before.status);
    store.pending = store.pending.filter((p) => p.version !== version.id);
    audit(
      store,
      input.action === "archive"
        ? "העברת סידור לסל המחזור"
        : "שחזור סידור כטיוטה",
      before,
      version,
    );
    write(store);
    return { ok: true };
  }
  if (
    input.action === "create" ||
    input.action === "publish" ||
    input.action === "reopen"
  ) {
    if (
      !input.week ||
      sunday(new Date(input.week + "T12:00:00Z")) !== input.week
    )
      throw new Error("יש לבחור תחילת שבוע תקינה");
    let version = data.schedule_versions.find(
      (v) =>
        v.week_start === input.week &&
        v.department_id === (input.department_id || data.departments[0]?.id) &&
        v.status !== "archived",
    );
    if (version?.status === "archived")
      throw new Error("יש לשחזר את הסידור מסל המחזור תחילה");
    if (
      !data.departments.some(
        (d) =>
          d.id === (input.department_id || data.departments[0]?.id) &&
          d.active !== false,
      )
    )
      throw new Error("המחלקה מושבתת או לא קיימת");
    if (input.action === "create") {
      if (!version) {
        version = {
          id: uid(),
          week_start: input.week,
          department_id: input.department_id || data.departments[0]?.id,
          status: "draft",
          revision: 0,
          created_at: new Date().toISOString(),
        };
        data.schedule_versions.push(version);
      }
      result = version.id;
    } else {
      if (!version) throw new Error("יש ליצור סידור שבועי תחילה");
      const previousStatus = version.status;
      const nextStatus = input.action === "publish" ? "published" : "draft";
      if (previousStatus === nextStatus) return version.id;
      if (input.action === "publish")
        validatePublication(store, version, new Set([version.id]));
      version.status = nextStatus;
      version.revision = Number(version.revision) + 1;
      notifyPublication(store, version, previousStatus);
      audit(
        store,
        input.action === "publish" ? "פרסום סידור מקומי" : "פתיחת סידור לעריכה",
        null,
        version,
      );
    }
  } else if (input.action === "preview") {
    const version = data.schedule_versions.find((v) => v.id === input.version);
    if (!version || version.status !== "draft" || !input.operations)
      throw new Error("אפשר לשנות רק סידור במצב טיוטה");
    const changes = operationChanges(data, version, input.operations);
    validate(data, apply(data.shift_assignments, changes), version);
    const pending = {
      id: uid(),
      version: version.id,
      revision: Number(version.revision),
      changes,
    };
    store.pending.push(pending);
    result = pending;
  } else {
    const pending = store.pending.find((p) => p.id === input.id);
    if (!pending) throw new Error("הבקשה כבר טופלה או אינה קיימת");
    if (input.action === "confirm") {
      const version = data.schedule_versions.find(
        (v) => v.id === pending.version,
      );
      if (
        !version ||
        version.status !== "draft" ||
        Number(version.revision) !== pending.revision
      )
        throw new Error("הסידור השתנה. יש לבקש תצוגה מקדימה חדשה");
      const assignments = apply(data.shift_assignments, pending.changes);
      validate(data, assignments, version);
      data.shift_assignments = assignments;
      version.revision = Number(version.revision) + 1;
      result = pending.changes;
      pending.changes.forEach((c) =>
        audit(store, "שינוי משמרת בהדגמה", c.before, c.after),
      );
    }
    store.pending = store.pending.filter((p) => p.id !== input.id);
  }
  write(store);
  return result;
}
