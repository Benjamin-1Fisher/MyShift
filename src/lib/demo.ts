import { z } from "zod";
import { adminSchema } from "./admin-schema";
import {
  addDays,
  duration,
  interval,
  localDate,
  operationSchema,
  overlaps,
  sunday,
  tables,
  type Assignment,
  type Data,
  type Row,
} from "./domain";

// This store is only called from the /demo client. Production never reads it.
export const DEMO_KEY = "myshift.demo.v1";
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
type Store = { schema: 1; data: Data; pending: Pending[] };
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
  return { schema: 1, data, pending: [] };
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
    dataSchema.parse(store.data);
    store.data.shift_assignments.forEach((a: Assignment) =>
      operationSchema.parse({ ...a, kind: "update" }),
    );
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
    const windows = data.availability.filter(
      (w) => w.employee_id === a.employee_id,
    );
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
      (v) => v.week_start === input.week && v.status !== "archived",
    );
    if (
      !version ||
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
      store.pending = store.pending.filter((p) => p.version !== active.id);
      audit(store, "שמירת הסידור הנוכחי לפני שחזור", beforeActive, active);
    }
    version.status = input.action === "archive" ? "archived" : "draft";
    version.archived_at =
      input.action === "archive" ? new Date().toISOString() : null;
    if (input.action === "restore")
      validate(data, data.shift_assignments, version);
    version.revision = Number(version.revision) + 1;
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
      (v) => v.week_start === input.week && v.status !== "archived",
    );
    if (version?.status === "archived")
      throw new Error("יש לשחזר את הסידור מסל המחזור תחילה");
    if (input.action === "create") {
      if (!version) {
        version = {
          id: uid(),
          week_start: input.week,
          status: "draft",
          revision: 0,
          created_at: new Date().toISOString(),
        };
        data.schedule_versions.push(version);
      }
      result = version.id;
    } else {
      if (!version) throw new Error("יש ליצור סידור שבועי תחילה");
      if (input.action === "publish")
        validate(data, data.shift_assignments, version);
      version.status = input.action === "publish" ? "published" : "draft";
      version.revision = Number(version.revision) + 1;
      data.notifications.unshift({
        id: uid(),
        message:
          input.action === "publish"
            ? "סידור ההדגמה פורסם מקומית. ניתן לצפות בו בתצוגת עובד בדפדפן הזה בלבד."
            : "סידור ההדגמה נפתח לעריכה",
        read: false,
        created_at: new Date().toISOString(),
        user_id: DEMO_ADMIN,
      });
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
    const changes: Change[] = [];
    const seen = new Set<string>();
    for (const op of input.operations) {
      const before =
        op.kind === "create"
          ? null
          : data.shift_assignments.find(
              (a) => a.id === op.id && a.version_id === version.id,
            );
      if (op.kind !== "create" && (!before || seen.has(op.id)))
        throw new Error("המשמרת השתנתה. רעננו ונסו שוב");
      if (op.kind !== "create") seen.add(op.id);
      const after =
        op.kind === "delete"
          ? null
          : ({
              ...op,
              id: op.kind === "create" ? uid() : op.id,
              version_id: version.id,
            } as Assignment);
      changes.push({ before: before || null, after });
    }
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
