"use client";
import Link from "next/link";
import ShiftEditor from "./shift-editor";
import { canAssign, planWeek, copyPreviousWeek } from "@/lib/planner";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Building2,
  Sparkles,
  Bell,
  History,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Search,
  ShieldCheck,
  LogOut,
  Menu,
  ArrowUpLeft,
  Check,
  X,
  Clock,
  Printer,
} from "lucide-react";
import {
  addDays,
  civilTime,
  duration,
  interval,
  localDate,
  shortages,
  sunday,
  type Assignment,
  type Data,
  type Operation,
  type Row,
  tables,
} from "@/lib/domain";
import * as Dialog from "@radix-ui/react-dialog";
type Preview = {
  id: string;
  changes: { before: Assignment | null; after: Assignment | null }[];
};
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Row[];
  required?: boolean;
  dependsOn?: string;
  optionParent?: string;
};
const nav = [
  ["dashboard", "סקירה כללית", LayoutDashboard],
  ["schedule", "סידורי עבודה", CalendarDays],
  ["employees", "עובדים", Users],
  ["departments", "מחלקות ואתרים", Building2],
  ["ai", "עוזר AI", Sparkles],
  ["notifications", "התראות", Bell],
  ["history", "יומן פעילות", History],
  ["settings", "הגדרות", Settings],
] as const;
const empty = Object.fromEntries(tables.map((t) => [t, []])) as unknown as Data;
const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const time = (v: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
async function serverPost(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "הפעולה נכשלה");
  return data;
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <div className="row between">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="סגירה">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted">
            בדקו את פרטי השינוי לפני האישור.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function EntityForm({
  fields,
  initial,
  onSubmit,
  submitLabel = "שמירה",
}: {
  submitLabel?: string;
  fields: Field[];
  initial?: Record<string, string>;
  onSubmit: (v: Record<string, string>) => Promise<void>;
}) {
  const [selections, setSelections] = useState<Record<string, string>>(
    initial || {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(
            Object.fromEntries(new FormData(e.currentTarget)) as Record<
              string,
              string
            >,
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.options ? (
              <select
                name={f.key}
                aria-label={f.label}
                value={selections[f.key] || ""}
                onChange={(e) => {
                  const next = { ...selections, [f.key]: e.target.value };
                  for (const child of fields.filter(
                    (child) => child.dependsOn === f.key,
                  )) {
                    const options =
                      child.options?.filter(
                        (o) =>
                          o[child.optionParent || child.dependsOn!] ===
                          e.target.value,
                      ) || [];
                    next[child.key] = options.length === 1 ? options[0].id : "";
                  }
                  setSelections(next);
                }}
                required={f.required !== false}
              >
                <option value="">בחירה…</option>
                {f.options
                  .filter(
                    (o) =>
                      !f.dependsOn ||
                      !selections[f.dependsOn] ||
                      o[f.optionParent || f.dependsOn] ===
                        selections[f.dependsOn],
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {String(o.name || o.id)}
                    </option>
                  ))}
              </select>
            ) : (
              <input
                name={f.key}
                aria-label={f.label}
                type={f.type || "text"}
                defaultValue={initial?.[f.key] || ""}
                required={f.required !== false}
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "שומר…" : submitLabel}
      </button>
    </form>
  );
}
export default function Workspace({
  configured,
  demo = false,
}: {
  configured: boolean;
  demo?: boolean;
}) {
  const router = useRouter();
  const demoLoaded = useRef(false);
  const [demoEmployee, setDemoEmployee] = useState("");
  const [demoReady, setDemoReady] = useState(false);
  const post: typeof serverPost = async (url, body) => {
    if (demo) {
      const { demoCommand } = await import("@/lib/demo");
      return demoCommand(url, body);
    }
    return serverPost(url, body);
  };
  const [client] = useState(() =>
    configured && !demo
      ? createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
      : null,
  );
  const [data, setData] = useState<Data>(empty),
    [userId, setUserId] = useState(""),
    [page, setPage] = useState("schedule"),
    [week, setWeek] = useState(sunday()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [filter, setFilter] = useState(""),
    [employeeFilter, setEmployeeFilter] = useState(""),
    [roleFilter, setRoleFilter] = useState(""),
    [availabilityFilter, setAvailabilityFilter] = useState(""),
    [siteFilter, setSiteFilter] = useState(""),
    [view, setView] = useState("week"),
    [search, setSearch] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [lastUndo, setLastUndo] = useState<{
    week: string;
    department_id: string;
    revision: number;
    operations: Operation[];
  } | null>(null);
  const [archivePrompt, setArchivePrompt] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<string | null>(null);
  const [editor, setEditor] = useState<Assignment | true | null>(null),
    [entity, setEntity] = useState<{
      kind: string;
      title: string;
      fields: Field[];
      initial?: Record<string, string>;
    } | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [importRows, setImportRows] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setFilter(
      new URLSearchParams(window.location.search).get("department") || "",
    );
    if (demo) {
      const { loadDemo, DEMO_ADMIN } = await import("@/lib/demo");
      const saved = loadDemo();
      if (
        !demoLoaded.current &&
        !saved.schedule_versions.some((v) => v.week_start === sunday())
      ) {
        const latest = saved.schedule_versions
          .map((v) => String(v.week_start))
          .sort()
          .at(-1);
        if (latest) {
          setWeek(latest);
          setNotice(
            "מוצג השבוע האחרון שנשמר בהדגמה. אפשר לעבור לשבוע הנוכחי וליצור סידור חדש.",
          );
        }
      }
      demoLoaded.current = true;
      setData(saved);
      setUserId(DEMO_ADMIN);
      setDemoReady(true);
      return;
    }
    if (!client) return;
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.status === 401) {
      setUserId("");
      setData(empty);
      return;
    }
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setData(result.data);
    setUserId(result.userId);
  }, [client, demo]);
  useEffect(() => {
    if (demo) {
      const refresh = () => {
        void load().catch((e) => setError(e.message));
      };
      refresh();
      const sync = (event: StorageEvent) => {
        if (event.key === "myshift.demo.v1") refresh();
      };
      window.addEventListener("storage", sync);
      return () => window.removeEventListener("storage", sync);
    }
    if (!client) return;
    let active = true;
    const refresh = () => load().catch((e) => active && setError(e.message));
    void refresh();
    const timer = setInterval(refresh, 10000);
    const { data: listener } = client.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.subscription.unsubscribe();
    };
  }, [client, load, demo]);
  const displayData = demoEmployee
    ? {
        ...data,
        shift_assignments: data.shift_assignments.filter(
          (a) =>
            a.employee_id === demoEmployee &&
            data.schedule_versions.some(
              (v) => v.id === a.version_id && v.status === "published",
            ),
        ),
      }
    : data;
  const profile = demoEmployee
      ? {
          id: demoEmployee,
          name: data.employees.find((e) => e.id === demoEmployee)?.name,
          role: "employee",
        }
      : data.profiles.find((p) => p.id === userId),
    isAdmin = profile?.role === "admin",
    canEdit = !!profile && profile.role !== "employee";
  const departments = data.departments.filter(
    (d) =>
      d.active !== false &&
      (isAdmin ||
        (canEdit
          ? data.manager_departments.some(
              (m) => m.user_id === userId && m.department_id === d.id,
            )
          : data.employee_departments.some(
              (m) =>
                m.department_id === d.id &&
                data.employees.some(
                  (e) =>
                    e.id === m.employee_id &&
                    (demoEmployee
                      ? e.id === demoEmployee
                      : e.user_id === userId),
                ),
            ))),
  );
  const departmentId = departments.some((d) => d.id === filter)
    ? filter
    : departments[0]?.id || "";
  const departmentEmployees = data.employees.filter((e) =>
    data.employee_departments.some(
      (m) => m.employee_id === e.id && m.department_id === departmentId,
    ),
  );
  const submitted = (id: string) =>
    data.availability.some(
      (a) =>
        a.employee_id === id &&
        String(a.starts_at) < addDays(week, 7) &&
        String(a.ends_at) > week,
    );
  const visibleEmployees = departmentEmployees.filter(
    (e) =>
      String(e.name).includes(search) &&
      (!roleFilter ||
        data.employee_departments.some(
          (m) =>
            m.employee_id === e.id &&
            m.department_id === departmentId &&
            m.role_id === roleFilter,
        )) &&
      (!siteFilter ||
        data.shift_assignments.some(
          (a) =>
            a.employee_id === e.id &&
            a.site_id === siteFilter &&
            localDate(a.starts_at) >= week &&
            localDate(a.starts_at) <= addDays(week, 6),
        )) &&
      (!availabilityFilter ||
        submitted(e.id) === (availabilityFilter === "submitted")),
  );
  const selectDepartment = (id: string) => {
    setFilter(id);
    setNotice("");
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.set("department", id);
    window.history.replaceState(null, "", url);
    setEmployeeFilter("");
    setRoleFilter("");
    setSiteFilter("");
    setAvailabilityFilter("");
    setLastUndo(null);
    setEditor(null);
  };
  const archivedSchedules = data.schedule_versions
    .filter(
      (v) =>
        v.week_start === week &&
        v.department_id === departmentId &&
        v.status === "archived",
    )
    .sort(
      (a, b) =>
        Date.parse(String(a.archived_at || a.created_at || "1970-01-01")) -
        Date.parse(String(b.archived_at || b.created_at || "1970-01-01")),
    );
  const archived = archivedSchedules.at(-1);
  const version = data.schedule_versions.find(
    (v) =>
      v.week_start === week &&
      v.department_id === departmentId &&
      v.status !== "archived",
  );
  const weekAssigned = displayData.shift_assignments.filter((a) =>
    data.schedule_versions.some(
      (v) =>
        v.id === a.version_id &&
        v.week_start === week &&
        v.status !== "archived",
    ),
  );
  const dashboardGaps = shortages(
    { ...data, shift_assignments: weekAssigned },
    week,
  );
  const assigned = displayData.shift_assignments.filter(
    (a) => a.version_id === version?.id,
  );
  const filtered = assigned.filter(
    (a) =>
      a.department_id === departmentId &&
      (!employeeFilter || a.employee_id === employeeFilter) &&
      (!siteFilter || a.site_id === siteFilter) &&
      (!roleFilter || a.role_id === roleFilter),
  );
  const conflicts = assigned.filter(
    (a) => a.employee_id && !canAssign(data, a, a.employee_id),
  );
  const gaps = shortages(
    {
      ...data,
      coverage_requirements: data.coverage_requirements.filter(
        (r) => r.department_id === departmentId,
      ),
      shift_assignments: assigned,
    },
    week,
  );
  const name = (table: keyof Data, id: unknown) =>
    String((data[table] as Row[]).find((r) => r.id === id)?.name || "לא משויך");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const commitChanges = async (
    operations: Operation[],
    remember = true,
    expectedRevision = Number(version?.revision || 0),
  ) => {
    if (!operations.length) {
      setNotice("הסידור כבר מעודכן. לא נדרשו שינויים.");
      return;
    }
    const vid =
      version?.id ||
      (await post("/api/change", {
        action: "create",
        week,
        department_id: departmentId,
      }));
    const proposed = await post("/api/change", {
      action: "preview",
      version: vid,
      operations,
    });
    if (Number(proposed.revision) !== expectedRevision) {
      await post("/api/change", { action: "cancel", id: proposed.id });
      throw new Error("הסידור השתנה. רעננו לפני השינוי או הביטול.");
    }
    const changes = (await post("/api/change", {
      action: "confirm",
      id: proposed.id,
    })) as Preview["changes"];
    if (remember && Array.isArray(changes))
      setLastUndo({
        week,
        department_id: departmentId,
        revision: expectedRevision + 1,
        operations: changes
          .slice()
          .reverse()
          .map((c) =>
            c.before
              ? { ...c.before, kind: c.after ? "update" : "create" }
              : { kind: "delete", id: c.after!.id },
          ) as Operation[],
      });
    await load();
    setNotice(
      demo
        ? "נשמר בדפדפן הזה בלבד. אפשר לבטל את הפעולה האחרונה."
        : "השינויים נשמרו. אפשר לבטל את הפעולה האחרונה.",
    );
  };
  const lifecycle = async (
    action: "archive" | "restore",
    selectedId?: string,
  ) => {
    const current =
      action === "archive"
        ? version
        : archivedSchedules.find((v) => v.id === selectedId) || archived;
    if (!current) throw new Error("הסידור כבר השתנה. רעננו ונסו שוב");
    await post("/api/change", {
      action,
      week,
      department_id: departmentId,
      id: current.id,
      active_id: version?.id || null,
      active_revision: version ? Number(version.revision) : null,
      revision: Number(current.revision),
    });
    setLastUndo(null);
    setArchivePrompt(false);
    setRestorePrompt(null);
    await load();
    setNotice(
      action === "archive"
        ? "הסידור הועבר לסל המחזור. כל המשמרות נשמרו לשחזור."
        : "הסידור שוחזר כטיוטה, כולל המשמרות והשיבוצים.",
    );
  };
  const propose = async (operations: Operation[]) => {
    const vid =
      version?.id ||
      (await post("/api/change", {
        action: "create",
        week,
        department_id: departmentId,
      }));
    if (!version) await load();
    setPreview(
      await post("/api/change", {
        action: "preview",
        version: vid,
        operations,
      }),
    );
  };
  const selectField = (
    key: string,
    label: string,
    options: Row[],
    required = true,
  ): Field => ({ key, label, options, required });
  const dep = selectField("department_id", "מחלקה", departments),
    emp = selectField("employee_id", "עובד", data.employees),
    site = selectField("site_id", "אתר", data.sites),
    role: Field = {
      ...selectField("role_id", "תפקיד / הכשרה", data.roles),
      dependsOn: "department_id",
    };
  const openEntity = (
    kind: string,
    title: string,
    fields: Field[],
    initial?: Record<string, string>,
  ) =>
    setEntity({
      kind,
      title,
      fields,
      initial: {
        department_id: departmentId,
        ...(kind === "employee" && !initial?.id ? { active: "true" } : {}),
        ...Object.fromEntries(
          fields
            .filter((f) => f.options?.length === 1)
            .map((f) => [f.key, f.options![0].id]),
        ),
        ...initial,
      },
    });
  const saveEntity = async (values: Record<string, string>) => {
    if (!entity) return;
    if (entity.kind === "swap") {
      const a = assigned.find((a) => a.id === values.first),
        b = assigned.find((a) => a.id === values.second);
      if (!a || !b || a.id === b.id)
        throw new Error("יש לבחור שתי משמרות שונות");
      await propose([
        { ...a, kind: "update", employee_id: b.employee_id },
        { ...b, kind: "update", employee_id: a.employee_id },
      ]);
      setEntity(null);
      return;
    }
    const v: Record<string, unknown> = { ...values };
    if (entity.initial?.id) v.id = entity.initial.id;
    if (entity.kind === "department") v.active = values.active !== "false";
    if (entity.kind === "employee") {
      v.active = values.active !== "false";
      v.user_id = values.user_id || null;
    }
    if (entity.kind === "template") {
      v.confirmed = values.confirmed === "true";
      v.start_time = values.start_time || null;
      v.end_time = values.end_time || null;
    }
    if (entity.kind === "settings" || entity.kind === "coverage")
      for (const k of [
        "min_rest_hours",
        "max_shift_hours",
        "weekday",
        "required_count",
      ])
        if (k in v) v[k] = Number(v[k]);
    if (entity.kind === "availability") {
      v.starts_at = civilTime(
        values.start.slice(0, 10),
        values.start.slice(11),
      );
      v.ends_at = civilTime(values.end.slice(0, 10), values.end.slice(11));
      delete v.start;
      delete v.end;
    }
    if (entity.kind === "permission")
      v.department_ids = (values.department_ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    await post("/api/admin", { kind: entity.kind, data: v });
    if (entity.kind === "employee" && values.department_id)
      selectDepartment(values.department_id);
    setEntity(null);
    await load();
    setNotice(
      entity.kind === "employee"
        ? "העובד נשמר ומוכן לשיבוץ"
        : "השינויים נשמרו בהצלחה",
    );
  };
  async function exportExcel() {
    const { exportWorkbook } = await import("@/lib/spreadsheet");
    await exportWorkbook(
      filtered.map((a) => ({
        תאריך: localDate(a.starts_at),
        מחלקה: name("departments", a.department_id),
        אתר: name("sites", a.site_id),
        תפקיד: name("roles", a.role_id),
        עובד: a.employee_id ? name("employees", a.employee_id) : "משמרת פתוחה",
        התחלה: time(a.starts_at),
        סיום: time(a.ends_at),
        "תאריך סיום": localDate(a.ends_at),
        שעות: duration(a),
        department_id: a.department_id,
        site_id: a.site_id,
        role_id: a.role_id,
        employee_id: a.employee_id || "",
        date: localDate(a.starts_at),
        start: time(a.starts_at),
        end: time(a.ends_at),
      })),
      `MyShift-${week}.xlsx`,
    );
  }

  const previewAssignments = preview
    ? assigned
        .filter((a) => !preview.changes.some((c) => c.before?.id === a.id))
        .concat(preview.changes.flatMap((c) => (c.after ? [c.after] : [])))
    : assigned;
  const previewGaps = shortages(
    {
      ...data,
      coverage_requirements: data.coverage_requirements.filter(
        (r) => r.department_id === departmentId,
      ),
      shift_assignments: previewAssignments,
    },
    week,
  );
  const renderCard = (a: Assignment) => (
    <article
      key={a.id}
      className={`shift ${!a.employee_id ? "open" : ""}`}
      style={{
        borderInlineStartColor: String(
          data.departments.find((d) => d.id === a.department_id)?.color ||
            "#8173cf",
        ),
      }}
    >
      <button
        className="shift-main"
        onClick={() => setEditor(a)}
        aria-label={`עריכת משמרת ${time(a.starts_at)} ${a.employee_id ? name("employees", a.employee_id) : "פנויה"}`}
      >
        <span className="shift-time" dir="ltr">
          {time(a.starts_at)} – {time(a.ends_at)}
        </span>
        <strong>
          {a.employee_id ? name("employees", a.employee_id) : "משמרת פנויה"}
        </strong>
        <small>{name("sites", a.site_id)}</small>
        <small>
          {localDate(a.ends_at) !== localDate(a.starts_at)
            ? "מסתיימת למחרת"
            : ""}
        </small>
      </button>
      {canEdit && version?.status === "draft" && (
        <select
          aria-label={`שיבוץ ${localDate(a.starts_at)} ${time(a.starts_at)} ${name("roles", a.role_id)}`}
          value={a.employee_id || ""}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              commitChanges([
                { ...a, kind: "update", employee_id: e.target.value || null },
              ]),
            )
          }
        >
          <option value="">ללא עובד · פנויה</option>
          {data.employees
            .filter(
              (e) =>
                e.active &&
                data.employee_departments.some(
                  (m) =>
                    m.employee_id === e.id &&
                    m.department_id === a.department_id &&
                    m.role_id === a.role_id,
                ),
            )
            .map((e) => (
              <option
                key={e.id}
                value={e.id}
                disabled={e.id !== a.employee_id && !canAssign(data, a, e.id)}
              >
                {String(e.name)}
              </option>
            ))}
        </select>
      )}
    </article>
  );
  if (!userId)
    return (
      <main className="connection-page">
        <section className="connection-card">
          <h1>{demo ? "טוענים את ההדגמה" : "כניסה ל־MyShift"}</h1>
          {demo ? (
            <p role={error ? "alert" : "status"}>
              {error || "מכינים את לוח העבודה המקומי…"}
            </p>
          ) : (
            <>
              <Link className="button" href="/demo">
                כניסה להדגמה
              </Link>
              <p>התחבר לחשבון הארגון כדי לנהל עובדים וסידורי עבודה.</p>
              <EntityForm
                submitLabel="כניסה"
                fields={[
                  { key: "email", label: "דוא״ל", type: "email" },
                  { key: "password", label: "סיסמה", type: "password" },
                ]}
                onSubmit={async (v) => {
                  const r = await client!.auth.signInWithPassword({
                    email: v.email,
                    password: v.password,
                  });
                  if (r.error) throw new Error("פרטי ההתחברות אינם תקינים");
                  await load();
                }}
              />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <p className="muted">
                אין חשבון? מנהל הארגון צריך להזמין אותך ולתת לך הרשאות.
              </p>
            </>
          )}
          <Link className="button" href="/">
            חזרה לדף הפתיחה
          </Link>
        </section>
      </main>
    );
  return (
    <div className={page === "schedule" ? "app planning" : "app"}>
      <aside className={menu ? "sidebar visible" : "sidebar"}>
        <Link className="brand" href="/">
          <span className="brand-icon">
            <ShieldCheck />
          </span>
          MyShift<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-name">
          מרחב ניהול האבטחה <span>WORKSPACE</span>
        </div>
        <nav>
          {nav
            .filter(([key]) =>
              ["dashboard", "schedule", "employees", "ai"].includes(key),
            )
            .map(([key, label, Icon]) => (
              <button
                className={page === key ? "nav-item active" : "nav-item"}
                key={key}
                onClick={() => {
                  setPage(key);
                  setMenu(false);
                }}
              >
                <Icon size={19} />
                {label}
                {key === "ai" && <span className="tiny-tag">בקרוב</span>}
                {key === "notifications" &&
                  data.notifications.some((n) => !n.read) && (
                    <i className="dot" />
                  )}
              </button>
            ))}
          <details className="nav-extra">
            <summary>ניהול נוסף</summary>{" "}
            {nav
              .filter(
                ([key]) =>
                  !["dashboard", "schedule", "employees", "ai"].includes(key),
              )
              .map(([key, label, Icon]) => (
                <button
                  className={page === key ? "nav-item active" : "nav-item"}
                  key={key}
                  onClick={() => {
                    setPage(key);
                    setMenu(false);
                  }}
                >
                  <Icon size={19} />
                  {label}
                  {key === "ai" && <span className="tiny-tag">בקרוב</span>}
                  {key === "notifications" &&
                    data.notifications.some((n) => !n.read) && (
                      <i className="dot" />
                    )}
                </button>
              ))}
          </details>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>הכול במקום אחד.</strong>
          <p>
            {demo
              ? "נתוני ההדגמה נשמרים רק בדפדפן הזה."
              : "הצוות, המשמרות והשינויים — מסונכרנים וברורים."}
          </p>
        </div>
        <div className="profile">
          <span className="avatar">
            {String(profile?.name || "מ").slice(0, 1)}
          </span>
          <div>
            <strong>{String(profile?.name || "מרחב העבודה שלך")}</strong>
            <small>
              {isAdmin
                ? "מנהל ראשי"
                : profile?.role === "manager"
                  ? "מנהל מחלקה"
                  : userId
                    ? "עובד"
                    : "נדרשת התחברות"}
            </small>
          </div>
          {userId && (
            <button
              aria-label="יציאה"
              onClick={() => {
                if (demo) router.push("/");
                else void client?.auth.signOut();
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="row">
            <button
              className="mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="תפריט"
            >
              <Menu />
            </button>
            <span className="muted">מרחב העבודה</span>
            <ChevronLeft size={14} />
            <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
          </div>
          <div className="row">
            <span className="connection">
              <i className="dot" />
              {demo
                ? "שמירה מקומית בדפדפן"
                : userId
                  ? "רענון אוטומטי · כל 10 שניות"
                  : "סביבת עבודה חדשה"}
            </span>
            <button
              aria-label="התראות"
              onClick={() => setPage("notifications")}
            >
              <Bell size={19} />
            </button>
          </div>
        </header>
        {demo && demoReady && (
          <div className="demo-banner" role="region" aria-label="מצב הדגמה">
            <div>
              <strong>מצב הדגמה — נתונים לדוגמה</strong>
              <span>
                השינויים נשמרים בדפדפן הזה בלבד, ללא מסד משותף. פרסום אינו שולח
                הודעות לעובדים.
              </span>
            </div>
            <div className="row">
              <label className="demo-view-label">
                תצוגה
                <select
                  aria-label="תצוגת הדגמה"
                  value={demoEmployee}
                  onChange={(e) => {
                    setDemoEmployee(e.target.value);
                    setPage("schedule");
                    setFilter("");
                    setEmployeeFilter("");
                    setSiteFilter("");
                    setView("week");
                  }}
                >
                  <option value="">מנהל</option>
                  {data.employees
                    .filter((e) => e.active)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        עובד · {String(e.name)}
                      </option>
                    ))}
                </select>
              </label>
              <Link className="button" href="/app">
                למערכת הארגונית
              </Link>
            </div>
          </div>
        )}
        <div className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">ניהול חכם. צוות מחובר.</span>
              <h1>
                {page === "dashboard"
                  ? `יום עבודה מסודר מתחיל כאן`
                  : nav.find((n) => n[0] === page)?.[1]}
              </h1>
              <p className="muted">
                {page === "dashboard"
                  ? "כל מה שצריך לדעת על הצוות והסידור השבועי, במבט אחד."
                  : "מרחב אחד לניהול מדויק, פשוט ומשותף."}
              </p>
            </div>
            <div className="row">
              {canEdit && !version && page !== "schedule" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post("/api/change", {
                        action: "create",
                        week,
                        department_id: departmentId,
                      });
                      setPage("schedule");
                      setNotice(
                        "הסידור השבועי נוצר. אפשר להתחיל להוסיף משמרות.",
                      );
                    })
                  }
                >
                  יצירת סידור שבועי
                </button>
              )}
              {canEdit && (
                <button
                  className="primary"
                  disabled={busy || version?.status === "published"}
                  onClick={() => {
                    setPage("schedule");
                    setShiftDate(week);
                    setEditor(true);
                  }}
                >
                  <Plus size={17} />
                  הוספת משמרת
                </button>
              )}
            </div>
          </div>
          {!configured && !demo && (
            <div className="setup-banner">
              <ShieldCheck />
              <div>
                <strong>מחברים את סביבת העבודה</strong>
                <p>
                  יש להגדיר Supabase כדי להתחבר ולשמור נתונים. הממשק מציג מצב
                  ריק אמיתי, ללא עובדים או שיבוצים מדומים. הוראות מלאות נמצאות
                  ב־README.
                </p>
              </div>
            </div>
          )}
          {configured && !userId && (
            <section className="panel login">
              <h2>כניסה למערכת</h2>
              <EntityForm
                submitLabel="כניסה"
                fields={[
                  { key: "email", label: "דוא״ל", type: "email" },
                  { key: "password", label: "סיסמה", type: "password" },
                ]}
                onSubmit={async (v) => {
                  const { error } = await client!.auth.signInWithPassword({
                    email: v.email,
                    password: v.password,
                  });
                  if (error) throw new Error("פרטי ההתחברות אינם תקינים");
                  await load();
                }}
              />
              <p className="muted">
                חשבון משתמש נוצר בהזמנה על ידי מנהל המערכת.
              </p>
            </section>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button onClick={() => setError("")} aria-label="סגירה">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert">
              {notice}
            </div>
          )}
          {isAdmin && (!data.departments.length || !data.sites.length) && (
            <section className="panel">
              <h2>הגדרה ראשונית של הארגון</h2>
              <p className="muted">
                מגדירים את האתר הראשון ואת ארבע המחלקות. לאחר מכן אפשר להוסיף
                עובדים ולשבץ אותם.
              </p>
              <EntityForm
                fields={[{ key: "site_name", label: "שם האתר הראשון" }]}
                onSubmit={async (v) => {
                  await post("/api/admin", { kind: "initialize", data: v });
                  await load();
                  setNotice(
                    "האתר והמחלקות נוצרו. אפשר להוסיף את העובד הראשון.",
                  );
                }}
              />
            </section>
          )}
          {isAdmin &&
            data.departments.length > 0 &&
            data.sites.length > 0 &&
            !data.employees.length && (
              <section className="panel">
                <h2>מוסיפים את העובד הראשון</h2>
                <p>
                  האתר והמחלקות מוכנים. בחר שם עובד, מחלקה ותפקיד — והוא יהיה
                  מוכן לשיבוץ.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setPage("employees");
                    openEntity("employee", "הוספת עובד", [
                      { key: "name", label: "שם העובד" },
                      dep,
                      role,
                    ]);
                  }}
                >
                  הוספת עובד ראשון
                </button>
              </section>
            )}
          {["schedule", "employees", "settings"].includes(page) &&
            departments.length > 0 && (
              <section className="department-picker" aria-label="בחירת מחלקה">
                <div
                  className="department-tabs"
                  role="tablist"
                  aria-label="מחלקות"
                >
                  {departments.map((d) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={departmentId === d.id}
                      aria-controls="department-content"
                      key={d.id}
                      onClick={() => selectDepartment(d.id)}
                      style={{
                        borderBottomColor:
                          departmentId === d.id
                            ? String(d.color)
                            : "transparent",
                      }}
                    >
                      {String(d.name)}
                    </button>
                  ))}
                </div>
                <div
                  id="department-content"
                  className="department-context"
                  role="status"
                >
                  <strong>{name("departments", departmentId)}</strong>
                  <span>
                    {canEdit ? "ניהול המחלקה" : "המחלקה שלי"} ·{" "}
                    {departmentEmployees.filter((e) => e.active).length} עובדים
                  </span>
                  {canEdit && (
                    <span>
                      {
                        departmentEmployees.filter(
                          (e) => e.active && submitted(e.id),
                        ).length
                      }{" "}
                      הגישו זמינות לשבוע ·{" "}
                      {
                        departmentEmployees.filter(
                          (e) => e.active && !submitted(e.id),
                        ).length
                      }{" "}
                      טרם הגישו
                    </span>
                  )}
                </div>
              </section>
            )}
          {page === "dashboard" && (
            <>
              <div className="stats">
                {[
                  [
                    CalendarDays,
                    "משמרות השבוע",
                    weekAssigned.length,
                    "בסידור הנבחר",
                  ],
                  [
                    Users,
                    "עובדים פעילים",
                    data.employees.filter((e) => e.active).length,
                    "במחלקות שבאחריותך",
                  ],
                  [
                    Clock,
                    "משמרות פתוחות",
                    weekAssigned.filter((a) => !a.employee_id).length,
                    "ממתינות לשיבוץ",
                  ],
                  [
                    ShieldCheck,
                    "פערי איוש",
                    dashboardGaps.reduce((s, g) => s + g.missing, 0),
                    "לפי הדרישות שהוגדרו",
                  ],
                ].map(([Icon, label, note, sub], i) => {
                  const I = Icon as typeof CalendarDays;
                  return (
                    <section className="stat" key={i}>
                      <div className="row between">
                        <span>{String(label)}</span>
                        <span className={`stat-icon s${i}`}>
                          <I size={20} />
                        </span>
                      </div>
                      <b>{String(note)}</b>
                      <small>{String(sub)}</small>
                    </section>
                  );
                })}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>תמונת מצב מחלקות</h2>
                      <p className="muted">
                        שבוע {week} · מעודכן לפי הרשאות הצפייה שלך
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("schedule")}
                    >
                      לסידור המלא <ArrowUpLeft size={17} />
                    </button>
                  </div>
                  {!data.departments.length ? (
                    <Empty text="המחלקות שלך יופיעו כאן לאחר חיבור והגדרה" />
                  ) : (
                    <div className="department-grid">
                      {data.departments.map((d) => {
                        const shifts = weekAssigned.filter(
                          (a) => a.department_id === d.id,
                        );
                        return (
                          <button
                            className="department-card"
                            key={d.id}
                            onClick={() => {
                              selectDepartment(d.id);
                              setPage("schedule");
                            }}
                          >
                            <span
                              className="department-icon"
                              style={{ color: String(d.color) }}
                            >
                              <Building2 />
                            </span>
                            <h3>{String(d.name)}</h3>
                            <p>{shifts.length} משמרות השבוע</p>
                            <div className="progress">
                              <span
                                style={{
                                  width: `${shifts.length ? (100 * shifts.filter((a) => a.employee_id).length) / shifts.length : 0}%`,
                                  background: String(d.color),
                                }}
                              />
                            </div>
                            <small>
                              {shifts.filter((a) => !a.employee_id).length}{" "}
                              משמרות פתוחות <ChevronLeft size={13} />
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
                <section className="ai-promo">
                  <div className="ai-star">
                    <Sparkles size={28} />
                  </div>
                  <span className="eyebrow">העוזר האישי שלך</span>
                  <h2>
                    פחות תפעול.
                    <br />
                    יותר שליטה.
                  </h2>
                  <p>
                    בקשה בשפה טבעית הופכת להצעה מסודרת. בודקים, מאשרים — ורק אז
                    מעדכנים.
                  </p>
                  <button onClick={() => setPage("ai")}>
                    בואו נסדר את השבוע <ArrowUpLeft size={17} />
                  </button>
                  <small>בקרוב — העוזר אינו פעיל</small>
                </section>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>תשומת לב לשבוע הקרוב</h2>
                  <span className="badge">{dashboardGaps.length} פערים</span>
                </div>
                {dashboardGaps.length ? (
                  dashboardGaps.map((g, i) => (
                    <div className="list-row" key={i}>
                      <span className="warning-icon">
                        <Clock size={18} />
                      </span>
                      <div>
                        <strong>
                          {name("departments", g.requirement.department_id)} ·{" "}
                          {g.day}
                        </strong>
                        <p>
                          חסרים {g.missing} עובדים · {time(g.starts_at)}–
                          {time(g.ends_at)} ·{" "}
                          {name("roles", g.requirement.role_id)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    text={
                      data.coverage_requirements.length
                        ? "לא נמצאו פערים בדרישות האיוש שהוגדרו"
                        : "טרם הוגדרו דרישות איוש. לאחר ההגדרה ניתן יהיה לזהות חוסרים."
                    }
                  />
                )}
              </section>
            </>
          )}
          {page === "schedule" && (
            <>
              {demoEmployee && (
                <div className="alert" role="status">
                  תצוגת עובד · {String(profile?.name)} — מוצגות רק המשמרות
                  האישיות בסידור שפורסם בדפדפן הזה.
                  {version?.status !== "published" &&
                    " השבוע הנבחר עדיין בטיוטה; חזרו לתצוגת מנהל כדי לפרסם אותו."}
                </div>
              )}
              {canEdit && (
                <section className="planner-actions" aria-label="ניהול הסידור">
                  <div>
                    <strong>
                      {name("departments", departmentId)} · סידור שבועי
                    </strong>
                    <p>
                      {assigned.length} משמרות ·{" "}
                      {assigned.filter((a) => !a.employee_id).length} פנויות
                      לשיבוץ
                    </p>
                  </div>
                  <div className="row">
                    {(!version || version.status === "draft") && (
                      <>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              commitChanges(
                                planWeek(data, week, "generate", departmentId),
                              ),
                            )
                          }
                        >
                          יצירת סידור בקליק
                        </button>
                        <button
                          disabled={
                            busy || !assigned.some((a) => !a.employee_id)
                          }
                          onClick={() =>
                            void run(() =>
                              commitChanges(
                                planWeek(data, week, "fill", departmentId),
                              ),
                            )
                          }
                        >
                          שיבוץ אוטומטי
                        </button>
                      </>
                    )}
                    {canEdit && version && (
                      <button
                        className={
                          version.status === "published" ? "" : "primary"
                        }
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await post("/api/change", {
                              action:
                                version.status === "published"
                                  ? "reopen"
                                  : "publish",
                              week,
                              department_id: departmentId,
                            });
                            setLastUndo(null);
                            setNotice(
                              version.status === "published"
                                ? "הסידור פתוח לעריכה"
                                : "הסידור פורסם. גם משמרות פנויות נשארות בסידור.",
                            );
                          })
                        }
                      >
                        {version.status === "published"
                          ? "פתיחה לעריכה"
                          : "פרסום סידור"}
                      </button>
                    )}
                    {canEdit && version && (
                      <button
                        disabled={busy}
                        onClick={() => setArchivePrompt(true)}
                      >
                        מחיקת סידור
                      </button>
                    )}
                    {canEdit && archived && !version && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void run(() => lifecycle("restore"))}
                      >
                        שחזור סידור
                      </button>
                    )}
                    {lastUndo?.week === week &&
                      lastUndo.department_id === departmentId &&
                      version?.status === "draft" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await commitChanges(
                                lastUndo.operations,
                                false,
                                lastUndo.revision,
                              );
                              setLastUndo(null);
                              setNotice("הפעולה האחרונה בוטלה");
                            })
                          }
                        >
                          ביטול הפעולה האחרונה
                        </button>
                      )}
                  </div>
                  {version?.status !== "published" && (
                    <details className="planner-more">
                      <summary>אפשרויות נוספות לשבוע</summary>
                      <div className="row">
                        <button
                          disabled={
                            busy || !assigned.some((a) => a.employee_id)
                          }
                          onClick={() =>
                            void run(() =>
                              commitChanges(
                                assigned
                                  .filter((a) => a.employee_id)
                                  .map((a) => ({
                                    ...a,
                                    kind: "update",
                                    employee_id: null,
                                  })),
                              ),
                            )
                          }
                        >
                          ניקוי שיבוצים בלבד
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              commitChanges(
                                planWeek(data, week, "open", departmentId),
                              ),
                            )
                          }
                        >
                          יצירת שבוע ללא שיבוץ
                        </button>
                        <button
                          disabled={busy || !!assigned.length}
                          onClick={() =>
                            void run(() =>
                              commitChanges(
                                copyPreviousWeek(data, week, departmentId),
                              ),
                            )
                          }
                        >
                          העתקת השבוע הקודם
                        </button>
                      </div>
                    </details>
                  )}
                  {canEdit && !!archivedSchedules.length && version && (
                    <details className="planner-more">
                      <summary>
                        סידורים שנמחקו ({archivedSchedules.length})
                      </summary>
                      <div className="trash-list">
                        {archivedSchedules
                          .slice()
                          .reverse()
                          .map((v, index) => (
                            <div className="row" key={v.id}>
                              <span>
                                סידור שנמחק ·{" "}
                                {
                                  data.shift_assignments.filter(
                                    (a) => a.version_id === v.id,
                                  ).length
                                }{" "}
                                משמרות
                                {v.archived_at || v.created_at
                                  ? ` · ${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(String(v.archived_at || v.created_at)))}`
                                  : ` · גרסה ${archivedSchedules.length - index}`}
                              </span>
                              <button
                                disabled={busy}
                                onClick={() => setRestorePrompt(v.id)}
                              >
                                שחזור סידור זה
                              </button>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                  <small>
                    {archived && !version
                      ? "הסידור הקודם נשמר בסל המחזור. אפשר ליצור סידור חדש לאותו שבוע או לשחזר את הקודם."
                      : "המערכת בודקת הכשרות וזמינות. כשאין עובד מתאים, המשמרת נשארת פנויה. אפשר לשנות הכול ידנית."}
                  </small>
                </section>
              )}
              {!!conflicts.length && (
                <p role="alert" className="staffing-warning">
                  {conflicts.length} שיבוצים דורשים בדיקה עקב חפיפה, זמינות או
                  הכשרה. יש לערוך את המשמרות לפני פרסום.
                </p>
              )}
              {!!gaps.length && (
                <p role="status" className="staffing-warning">
                  פערי איוש במחלקה: חסרים{" "}
                  {gaps.reduce((n, g) => n + g.missing, 0)} שיבוצים לפי הדרישות
                  שהוגדרו
                </p>
              )}
              <section className="panel schedule-panel">
                <div className="toolbar">
                  <div className="row">
                    <button
                      aria-label="שבוע קודם"
                      onClick={() => setWeek(addDays(week, -7))}
                    >
                      <ChevronRight size={18} />
                    </button>
                    <h2>
                      {new Intl.DateTimeFormat("he-IL", {
                        day: "numeric",
                        month: "long",
                      }).format(new Date(week + "T12:00:00Z"))}{" "}
                      –{" "}
                      {new Intl.DateTimeFormat("he-IL", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }).format(new Date(addDays(week, 6) + "T12:00:00Z"))}
                    </h2>
                    <button
                      aria-label="שבוע הבא"
                      onClick={() => setWeek(addDays(week, 7))}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button onClick={() => setWeek(sunday())}>השבוע</button>
                    <span className="badge">
                      {version?.status === "published"
                        ? "פורסם"
                        : version
                          ? "טיוטה"
                          : archived
                            ? "אין סידור פעיל"
                            : "טרם נוצר"}
                    </span>
                  </div>
                  <details className="planner-tools">
                    <summary>ייצוא וייבוא</summary>
                    <div className="row">
                      <button onClick={() => void run(exportExcel)}>
                        <Download size={16} /> Excel
                      </button>
                      <label className="button">
                        <Upload size={16} /> ייבוא
                        <input
                          type="file"
                          hidden
                          accept=".csv,.xlsx"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file)
                              void run(async () => {
                                if (file.size > 2_000_000)
                                  throw new Error("גודל קובץ מרבי: 2MB");
                                const { parseWorkbook } =
                                  await import("@/lib/spreadsheet");
                                const rows = await parseWorkbook(file);
                                if (rows.length > 100)
                                  throw new Error("עד 100 שורות בייבוא אחד");
                                setImportRows(rows);
                                setMapping({});
                              });
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button onClick={() => window.print()} aria-label="הדפסה">
                        <Printer size={17} />
                      </button>
                    </div>
                  </details>
                </div>
                <details className="planner-filter">
                  <summary>סינון ותצוגות נוספות</summary>
                  <div className="toolbar filters">
                    <div className="row">
                      <select
                        aria-label="עובד"
                        value={employeeFilter}
                        onChange={(e) => setEmployeeFilter(e.target.value)}
                      >
                        <option value="">כל העובדים</option>
                        {departmentEmployees.map((d) => (
                          <option value={d.id} key={d.id}>
                            {String(d.name)}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="אתר"
                        value={siteFilter}
                        onChange={(e) => setSiteFilter(e.target.value)}
                      >
                        <option value="">כל האתרים</option>
                        {data.sites.map((d) => (
                          <option value={d.id} key={d.id}>
                            {String(d.name)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row">
                      <select
                        aria-label="תצוגה"
                        value={view}
                        onChange={(e) => setView(e.target.value)}
                      >
                        <option value="week">שבוע</option>
                        <option value="month">חודש</option>
                        <option value="employee">לפי עובד</option>
                      </select>
                      {canEdit && version?.status === "draft" && (
                        <button
                          onClick={() =>
                            openEntity("swap", "החלפת עובדים בין משמרות", [
                              selectField(
                                "first",
                                "משמרת ראשונה",
                                assigned.map((a) => ({
                                  id: a.id,
                                  name: `${name("employees", a.employee_id)} · ${localDate(a.starts_at)} ${time(a.starts_at)}`,
                                })),
                              ),
                              selectField(
                                "second",
                                "משמרת שנייה",
                                assigned.map((a) => ({
                                  id: a.id,
                                  name: `${name("employees", a.employee_id)} · ${localDate(a.starts_at)} ${time(a.starts_at)}`,
                                })),
                              ),
                            ])
                          }
                        >
                          החלפה
                        </button>
                      )}
                    </div>
                  </div>
                </details>
                {canEdit &&
                !assigned.length &&
                (!version || version.status === "draft") ? (
                  <section
                    className="empty-week-message"
                    aria-label="יצירת סידור לשבוע הנבחר"
                  >
                    <CalendarDays size={34} />
                    <h2>מתחילים סידור חדש לשבוע הזה</h2>
                    <p>
                      {archivedSchedules.length
                        ? "הסידורים הקודמים שמורים בסל המחזור. אפשר ליצור חדש בלי לאבד אותם."
                        : "יוצרים את המשמרות של השבוע, ואז משבצים או משאירים אותן פנויות."}
                    </p>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            commitChanges(
                              planWeek(data, week, "generate", departmentId),
                            ),
                          )
                        }
                      >
                        יצירת סידור חדש
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            commitChanges(
                              planWeek(data, week, "open", departmentId),
                            ),
                          )
                        }
                      >
                        יצירה ללא שיבוץ
                      </button>
                    </div>
                  </section>
                ) : view === "week" ? (
                  <div className="week-grid">
                    {days.map((d, i) => {
                      const day = addDays(week, i);
                      return (
                        <div
                          className="day-column"
                          key={d}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const a = assigned.find(
                              (a) =>
                                a.id === e.dataTransfer.getData("text/plain"),
                            );
                            if (a)
                              void run(async () => {
                                const moved = interval(
                                  day,
                                  time(a.starts_at),
                                  time(a.ends_at),
                                );
                                await propose([
                                  { kind: "update", ...a, ...moved },
                                ]);
                              });
                          }}
                        >
                          <div
                            className={`day-header ${day === localDate(new Date().toISOString()) ? "today" : ""}`}
                          >
                            <span>יום {d}</span>
                            <strong>
                              {day.slice(8)}.{day.slice(5, 7)}
                            </strong>
                          </div>
                          <div className="day-shifts">
                            {Array.from(
                              new Set(
                                filtered
                                  .filter((a) => localDate(a.starts_at) === day)
                                  .sort((a, b) =>
                                    a.starts_at.localeCompare(b.starts_at),
                                  )
                                  .map((a) => time(a.starts_at)),
                              ),
                            ).map((start) => (
                              <section className="shift-group" key={start}>
                                <h3>
                                  {String(
                                    data.shift_templates.find(
                                      (t) =>
                                        t.department_id === departmentId &&
                                        t.confirmed &&
                                        String(t.start_time).slice(0, 5) ===
                                          start,
                                    )?.name || "שעות מותאמות",
                                  )}{" "}
                                  <span dir="ltr">{start}</span>
                                </h3>
                                {filtered
                                  .filter(
                                    (a) =>
                                      localDate(a.starts_at) === day &&
                                      time(a.starts_at) === start,
                                  )
                                  .sort((a, b) =>
                                    a.starts_at.localeCompare(b.starts_at),
                                  )
                                  .map(renderCard)}
                              </section>
                            ))}
                            {canEdit && version?.status !== "published" && (
                              <button
                                className="add-day-shift"
                                onClick={() => {
                                  setShiftDate(addDays(week, i));
                                  setEditor(true);
                                }}
                              >
                                + משמרת
                              </button>
                            )}
                            {!filtered.some(
                              (a) => localDate(a.starts_at) === day,
                            ) && <span className="no-shifts">אין משמרות</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : view === "month" ? (
                  <div className="month-grid">
                    {Array.from(
                      { length: 31 },
                      (_, i) =>
                        week.slice(0, 8) + String(i + 1).padStart(2, "0"),
                    )
                      .filter(
                        (day) =>
                          !isNaN(Date.parse(day)) &&
                          new Date(day).getUTCMonth() ===
                            new Date(week).getUTCMonth(),
                      )
                      .map((day) => (
                        <div className="month-day" key={day}>
                          <strong>{day}</strong>
                          {displayData.shift_assignments
                            .filter(
                              (a) =>
                                !data.schedule_versions.some(
                                  (v) =>
                                    v.id === a.version_id &&
                                    v.status === "archived",
                                ) &&
                                localDate(a.starts_at) === day &&
                                a.department_id === departmentId &&
                                (!siteFilter || a.site_id === siteFilter) &&
                                (!employeeFilter ||
                                  a.employee_id === employeeFilter),
                            )
                            .map(renderCard)}
                        </div>
                      ))}
                  </div>
                ) : (
                  departmentEmployees
                    .filter((e) => !employeeFilter || e.id === employeeFilter)
                    .map((e) => (
                      <section className="employee-schedule" key={e.id}>
                        <h3>
                          {String(e.name)}{" "}
                          <span className="muted">
                            {filtered
                              .filter((a) => a.employee_id === e.id)
                              .reduce((s, a) => s + duration(a), 0)
                              .toFixed(1)}{" "}
                            שעות
                          </span>
                        </h3>
                        <div className="card-row">
                          {filtered
                            .filter((a) => a.employee_id === e.id)
                            .map(renderCard)}
                        </div>
                      </section>
                    ))
                )}
                <div className="schedule-footer">
                  <span>
                    <i className="dot" />
                    {demoEmployee
                      ? "צפייה בסידור אישי שפורסם"
                      : "בחירת עובד בכרטיס שומרת מיד · אפשר להשאיר משמרת פנויה"}
                  </span>
                  <span>שעות לפי שעון ישראל · סוף משמרת לילה ביום הבא</span>
                </div>
              </section>
            </>
          )}
          {page === "employees" && (
            <section className="panel">
              <div className="section-heading">
                <h2>
                  אנשי הצוות{" "}
                  <span className="badge">{data.employees.length}</span>
                </h2>
                <div className="row">
                  <Search size={17} />
                  <input
                    placeholder="חיפוש עובד"
                    aria-label="חיפוש עובד"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {isAdmin && (
                    <button
                      onClick={() =>
                        openEntity("employee", "הוספת עובד", [
                          { key: "name", label: "שם תצוגה" },
                          dep,
                          role,
                          {
                            key: "active",
                            label: "מצב",
                            options: [
                              { id: "true", name: "פעיל" },
                              { id: "false", name: "לא פעיל" },
                            ],
                          },
                        ])
                      }
                    >
                      <Plus size={16} />
                      עובד חדש
                    </button>
                  )}
                </div>
              </div>
              <div className="employee-filters row">
                <label>
                  תפקיד
                  <select
                    aria-label="סינון תפקיד"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">כל התפקידים</option>
                    {data.roles
                      .filter((r) => r.department_id === departmentId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {String(r.name)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  מיקום
                  <select
                    aria-label="סינון מיקום"
                    value={siteFilter}
                    onChange={(e) => setSiteFilter(e.target.value)}
                  >
                    <option value="">כל המיקומים</option>
                    {data.sites.map((r) => (
                      <option key={r.id} value={r.id}>
                        {String(r.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  הגשת זמינות
                  <select
                    aria-label="סינון זמינות"
                    value={availabilityFilter}
                    onChange={(e) => setAvailabilityFilter(e.target.value)}
                  >
                    <option value="">כולם</option>
                    <option value="submitted">הגישו השבוע</option>
                    <option value="missing">טרם הגישו</option>
                  </select>
                </label>
              </div>
              <table className="employees-table">
                <thead>
                  <tr>
                    <th>עובד</th>
                    <th>מחלקות והכשרות</th>
                    <th>מצב</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <span className="avatar small">
                          {String(e.name).slice(0, 1)}
                        </span>
                        {String(e.name)}
                      </td>
                      <td>
                        {data.employee_departments
                          .filter((m) => m.employee_id === e.id)
                          .map(
                            (m) =>
                              `${name("departments", m.department_id)} / ${name("roles", m.role_id)}`,
                          )
                          .join(" · ") || "טרם שויך"}
                      </td>
                      <td>
                        <span className="badge">
                          {e.active ? "פעיל" : "לא פעיל"} ·{" "}
                          {submitted(e.id)
                            ? "הוגשה זמינות"
                            : "טרם הוגשה זמינות"}
                        </span>
                      </td>
                      <td>
                        {!isAdmin &&
                          (e.user_id === userId ||
                            e.id === demoEmployee ||
                            (canEdit &&
                              data.employee_departments
                                .filter((m) => m.employee_id === e.id)
                                .every((m) =>
                                  departments.some(
                                    (d) => d.id === m.department_id,
                                  ),
                                ))) && (
                            <button
                              onClick={() =>
                                openEntity(
                                  "availability",
                                  "הגשת זמינות ואילוצים",
                                  [
                                    { ...emp, options: [e] },
                                    {
                                      key: "start",
                                      label: "מתאריך ושעה",
                                      type: "datetime-local",
                                    },
                                    {
                                      key: "end",
                                      label: "עד תאריך ושעה",
                                      type: "datetime-local",
                                    },
                                    {
                                      key: "kind",
                                      label: "סוג",
                                      options: [
                                        { id: "available", name: "זמין" },
                                        { id: "unavailable", name: "לא זמין" },
                                        { id: "leave", name: "חופשה" },
                                      ],
                                    },
                                  ],
                                  { employee_id: e.id },
                                )
                              }
                            >
                              הגשת זמינות
                            </button>
                          )}
                        {isAdmin && (
                          <div className="row">
                            <button
                              onClick={() =>
                                openEntity(
                                  "employee",
                                  "עריכת עובד",
                                  [
                                    { key: "name", label: "שם" },
                                    ...(!demo
                                      ? [
                                          {
                                            key: "user_id",
                                            label: "מזהה משתמש",
                                            required: false,
                                          },
                                        ]
                                      : []),
                                    {
                                      key: "active",
                                      label: "מצב",
                                      options: [
                                        { id: "true", name: "פעיל" },
                                        { id: "false", name: "לא פעיל" },
                                      ],
                                    },
                                  ],
                                  {
                                    id: e.id,
                                    name: String(e.name),
                                    active: String(e.active),
                                    user_id: String(e.user_id || ""),
                                  },
                                )
                              }
                            >
                              עריכה
                            </button>
                            <button
                              onClick={() =>
                                openEntity(
                                  "membership",
                                  "שיוך והכשרה",
                                  [emp, dep, role],
                                  { employee_id: e.id },
                                )
                              }
                            >
                              הכשרה
                            </button>
                            <button
                              onClick={() =>
                                openEntity(
                                  "availability",
                                  "זמינות וחופשה",
                                  [
                                    emp,
                                    {
                                      key: "start",
                                      label: "מתאריך ושעה",
                                      type: "datetime-local",
                                    },
                                    {
                                      key: "end",
                                      label: "עד תאריך ושעה",
                                      type: "datetime-local",
                                    },
                                    {
                                      key: "kind",
                                      label: "סוג",
                                      options: [
                                        {
                                          id: "unavailable",
                                          name: "לא זמין",
                                        },
                                        { id: "leave", name: "חופשה" },
                                        { id: "available", name: "זמין" },
                                      ],
                                    },
                                  ],
                                  { employee_id: e.id },
                                )
                              }
                            >
                              זמינות
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.employees.length && (
                <Empty text="עדיין אין עובדים להצגה" />
              )}
              <h3>חלונות זמינות וחופשות</h3>
              {data.availability
                .filter((a) =>
                  departmentEmployees.some((e) => e.id === a.employee_id),
                )
                .map((a) => (
                  <div className="list-row" key={a.id}>
                    {name("employees", a.employee_id)} ·{" "}
                    {a.kind === "available"
                      ? "זמין"
                      : a.kind === "leave"
                        ? "חופשה"
                        : "לא זמין"}{" "}
                    · {String(a.starts_at)} — {String(a.ends_at)}
                  </div>
                ))}
            </section>
          )}
          {page === "departments" && (
            <section className="panel">
              <div className="section-heading">
                <h2>מבנה הארגון</h2>
                {isAdmin && (
                  <div className="row">
                    <button
                      onClick={() =>
                        openEntity("department", "מחלקה חדשה", [
                          { key: "name", label: "שם" },
                          { key: "color", label: "צבע", type: "color" },
                        ])
                      }
                    >
                      מחלקה חדשה
                    </button>
                    <button
                      onClick={() =>
                        openEntity("site", "אתר חדש", [
                          { key: "name", label: "שם" },
                        ])
                      }
                    >
                      אתר חדש
                    </button>
                    <button
                      onClick={() =>
                        openEntity("role", "תפקיד חדש", [
                          dep,
                          { key: "name", label: "שם תפקיד" },
                        ])
                      }
                    >
                      תפקיד חדש
                    </button>
                  </div>
                )}
              </div>
              {data.departments.map((d) => (
                <div className="list-row" key={d.id}>
                  <span
                    className="department-icon"
                    style={{ color: String(d.color) }}
                  >
                    <Building2 />
                  </span>
                  <div>
                    <strong>
                      {String(d.name)}
                      {d.active === false ? " · מושבתת" : ""}
                    </strong>
                    <p>
                      {data.roles
                        .filter((r) => r.department_id === d.id)
                        .map((r) => String(r.name))
                        .join(" · ") || "טרם הוגדרו תפקידים"}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() =>
                        openEntity(
                          "department",
                          "עריכת מחלקה",
                          [
                            { key: "name", label: "שם" },
                            { key: "color", label: "צבע", type: "color" },
                            {
                              key: "active",
                              label: "מצב מחלקה",
                              options: [
                                { id: "true", name: "פעילה" },
                                {
                                  id: "false",
                                  name: "מושבתת — שמירת היסטוריה",
                                },
                              ],
                            },
                          ],
                          {
                            id: d.id,
                            name: String(d.name),
                            color: String(d.color),
                            active: String(d.active !== false),
                          },
                        )
                      }
                    >
                      עריכה
                    </button>
                  )}
                </div>
              ))}
              <h3>אתרים</h3>
              {data.sites.map((s) => (
                <div className="list-row" key={s.id}>
                  {String(s.name)}
                  {isAdmin && (
                    <button
                      onClick={() =>
                        openEntity(
                          "site",
                          "עריכת אתר",
                          [{ key: "name", label: "שם" }],
                          { id: s.id, name: String(s.name) },
                        )
                      }
                    >
                      עריכה
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {page === "ai" && (
            <section className="panel chat">
              <div className="chat-intro">
                <span className="ai-star">
                  <Sparkles />
                </span>
                <h2>עוזר AI — בקרוב</h2>
                <p className="muted">
                  העוזר אינו פעיל כרגע. אפשר להוסיף עובדים ולשבץ משמרות באופן
                  ידני.
                </p>
              </div>
              <div className="chat-input">
                <input disabled placeholder="בקרוב" aria-label="בקשה לעוזר" />
                <button className="primary" disabled>
                  בקרוב <Sparkles size={16} />
                </button>
              </div>
            </section>
          )}
          {page === "notifications" && (
            <section className="panel">
              <h2>עדכונים לצוות</h2>
              {data.notifications.map((n) => (
                <div className="list-row" key={n.id}>
                  <Bell size={18} />
                  <div>
                    <strong>{String(n.message)}</strong>
                    <p>
                      {new Date(String(n.created_at)).toLocaleString("he-IL", {
                        timeZone: "Asia/Jerusalem",
                      })}
                    </p>
                  </div>
                  {!n.read && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          await post("/api/admin", {
                            kind: "notification",
                            data: { id: n.id },
                          });
                        })
                      }
                    >
                      סימון כנקרא
                    </button>
                  )}
                </div>
              ))}
              {!data.notifications.length && <Empty text="אין התראות חדשות" />}
            </section>
          )}
          {page === "history" && (
            <section className="panel">
              <h2>יומן פעילות</h2>
              <p className="muted">
                200 הפעולות האחרונות בתחומי ההרשאה שלך. שחזור יוצר שינוי חדש
                לבדיקה ולאישור.
              </p>
              {data.audit_logs.map((a) => (
                <details key={a.id} className="audit">
                  <summary>
                    {new Date(String(a.created_at)).toLocaleString("he-IL", {
                      timeZone: "Asia/Jerusalem",
                    })}{" "}
                    · {String(a.entity)} · מבצע: {String(a.actor_id)}
                  </summary>
                  <div className="diff">
                    <pre>{JSON.stringify(a.before_data, null, 2)}</pre>
                    <pre>{JSON.stringify(a.after_data, null, 2)}</pre>
                  </div>
                  {a.entity === "shift" && canEdit && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          const before = a.before_data as Assignment | null,
                            after = a.after_data as Assignment | null;
                          const current = data.shift_assignments.find(
                            (s) => s.id === a.entity_id,
                          );
                          if (a.version_id !== version?.id)
                            throw new Error("בחר תחילה את שבוע השינוי בלוח");
                          if (
                            !current !== !after ||
                            (current &&
                              after &&
                              [
                                "id",
                                "version_id",
                                "department_id",
                                "site_id",
                                "role_id",
                                "employee_id",
                                "starts_at",
                                "ends_at",
                              ].some(
                                (k) =>
                                  current[k as keyof Assignment] !==
                                  after[k as keyof Assignment],
                              ))
                          )
                            throw new Error(
                              "המשמרת השתנתה מאז. יש לערוך ידנית",
                            );
                          const op: Operation = before
                            ? { ...before, kind: current ? "update" : "create" }
                            : { kind: "delete", id: String(a.entity_id) };
                          await propose([op]);
                        })
                      }
                    >
                      תצוגה מקדימה לשחזור
                    </button>
                  )}
                </details>
              ))}
              {!data.audit_logs.length && <Empty text="טרם נרשמה פעילות" />}
            </section>
          )}
          {page === "settings" && (
            <section className="panel">
              <h2>הגדרות סידור</h2>
              <p className="muted">
                כללים תפעוליים לבחירת מנהל. אין כאן קביעה של דרישות חוק.
              </p>
              {canEdit && (
                <div className="action-grid">
                  {isAdmin && (
                    <button
                      onClick={() =>
                        openEntity(
                          "settings",
                          "מנוחה ומשך משמרת",
                          [
                            {
                              key: "min_rest_hours",
                              label: "שעות מנוחה מינימליות",
                              type: "number",
                            },
                            {
                              key: "max_shift_hours",
                              label: "משך משמרת מרבי",
                              type: "number",
                            },
                          ],
                          {
                            min_rest_hours: String(
                              data.settings[0]?.min_rest_hours ?? 0,
                            ),
                            max_shift_hours: String(
                              data.settings[0]?.max_shift_hours ?? 24,
                            ),
                          },
                        )
                      }
                    >
                      כללי מנוחה ושעות
                    </button>
                  )}
                  <button
                    onClick={() =>
                      openEntity("template", "תבנית משמרת חדשה", [
                        dep,
                        { key: "name", label: "שם" },
                        {
                          key: "start_time",
                          label: "התחלה",
                          type: "time",
                          required: false,
                        },
                        {
                          key: "end_time",
                          label: "סיום (רק אם אומת)",
                          type: "time",
                          required: false,
                        },
                        {
                          key: "confirmed",
                          label: "שעות מאומתות",
                          options: [
                            { id: "false", name: "לא מאומת" },
                            { id: "true", name: "מאומת" },
                          ],
                        },
                      ])
                    }
                  >
                    תבנית משמרת חדשה
                  </button>
                  <button
                    onClick={() =>
                      openEntity("coverage", "דרישת איוש", [
                        dep,
                        site,
                        role,
                        {
                          key: "weekday",
                          label: "יום",
                          options: days.map((d, i) => ({
                            id: String(i),
                            name: d,
                          })),
                        },
                        { key: "start_time", label: "התחלה", type: "time" },
                        { key: "end_time", label: "סיום", type: "time" },
                        {
                          key: "required_count",
                          label: "מספר עובדים",
                          type: "number",
                        },
                      ])
                    }
                  >
                    דרישת איוש חדשה
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() =>
                        openEntity("permission", "הרשאות משתמש", [
                          { key: "user_id", label: "מזהה משתמש" },
                          {
                            key: "role",
                            label: "הרשאה",
                            options: [
                              { id: "admin", name: "מנהל ראשי" },
                              { id: "manager", name: "מנהל מחלקה" },
                              { id: "employee", name: "עובד" },
                            ],
                          },
                          {
                            key: "department_ids",
                            label: "מזהי מחלקות מופרדים בפסיק",
                            required: false,
                          },
                        ])
                      }
                    >
                      הרשאות
                    </button>
                  )}
                </div>
              )}
              <h3>תבניות משמרת</h3>
              {data.shift_templates
                .filter((t) => t.department_id === departmentId)
                .map((t) => (
                  <div className="list-row" key={t.id}>
                    <strong>{String(t.name)}</strong>
                    <span>
                      {name("departments", t.department_id)} ·{" "}
                      {t.confirmed
                        ? `${t.start_time}–${t.end_time}`
                        : "שעות לא מאומתות — אין להשתמש לשיבוץ"}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() =>
                          openEntity(
                            "template",
                            "עריכת תבנית",
                            [
                              dep,
                              { key: "name", label: "שם" },
                              {
                                key: "start_time",
                                label: "התחלה",
                                type: "time",
                                required: false,
                              },
                              {
                                key: "end_time",
                                label: "סיום",
                                type: "time",
                                required: false,
                              },
                              {
                                key: "confirmed",
                                label: "מאומת",
                                options: [
                                  { id: "false", name: "לא" },
                                  { id: "true", name: "כן" },
                                ],
                              },
                            ],
                            Object.fromEntries(
                              Object.entries(t).map(([k, v]) => [
                                k,
                                v == null ? "" : String(v),
                              ]),
                            ),
                          )
                        }
                      >
                        עריכה
                      </button>
                    )}
                  </div>
                ))}
              <h3>דרישות איוש</h3>
              {data.coverage_requirements
                .filter((c) => c.department_id === departmentId)
                .map((c) => (
                  <div className="list-row" key={c.id}>
                    {name("departments", c.department_id)} ·{" "}
                    {days[Number(c.weekday)]} · {String(c.start_time)}–
                    {String(c.end_time)} · {String(c.required_count)} עובדים
                    {canEdit && (
                      <button
                        onClick={() =>
                          openEntity(
                            "coverage",
                            "עריכת דרישת איוש",
                            [
                              dep,
                              site,
                              role,
                              {
                                key: "weekday",
                                label: "יום",
                                options: days.map((name, i) => ({
                                  id: String(i),
                                  name,
                                })),
                              },
                              {
                                key: "start_time",
                                label: "התחלה",
                                type: "time",
                              },
                              { key: "end_time", label: "סיום", type: "time" },
                              {
                                key: "required_count",
                                label: "מספר עובדים",
                                type: "number",
                              },
                            ],
                            Object.fromEntries(
                              Object.entries(c).map(([k, v]) => [k, String(v)]),
                            ),
                          )
                        }
                      >
                        עריכה
                      </button>
                    )}
                  </div>
                ))}
              <div className="setup-banner">
                <Building2 />
                <p>
                  מערכת סידורים חיצונית: לא מחוברת. נדרש API מתועד והרשאות. ניתן
                  להשתמש בייבוא ובייצוא הידניים.
                </p>
              </div>
            </section>
          )}
          <footer>
            MyShift · ניהול משמרות עם תמונה מלאה <span>Asia/Jerusalem</span>
          </footer>
        </div>
      </main>
      {restorePrompt && (
        <Modal
          title="שחזור סידור קודם"
          close={() => !busy && setRestorePrompt(null)}
        >
          <p>
            הסידור הנוכחי יישמר בסל המחזור, והסידור שבחרת יחזור כטיוטה עם כל
            המשמרות והשיבוצים שלו. שום סידור לא יימחק לצמיתות.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() => lifecycle("restore", restorePrompt))
              }
            >
              אישור שחזור
            </button>
            <button disabled={busy} onClick={() => setRestorePrompt(null)}>
              ביטול
            </button>
          </div>
        </Modal>
      )}
      {archivePrompt && (
        <Modal
          title="העברת הסידור לסל המחזור"
          close={() => !busy && setArchivePrompt(false)}
        >
          <p>
            כל {assigned.length} המשמרות והשיבוצים של השבוע יוסתרו. אפשר לשחזר
            אותם בשלמותם, גם אחרי רענון. עובדים לא יראו את הסידור עד שישוחזר
            ויפורסם מחדש.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              className="danger compact"
              disabled={busy}
              onClick={() => void run(() => lifecycle("archive"))}
            >
              העברה לסל המחזור
            </button>
            <button disabled={busy} onClick={() => setArchivePrompt(false)}>
              ביטול
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={editor === true || !editor.id ? "הוספת משמרת" : "עריכת משמרת"}
          close={() => setEditor(null)}
        >
          {canEdit && version?.status !== "published" ? (
            <ShiftEditor
              key={
                editor === true
                  ? `new-${shiftDate}-${week}`
                  : editor.id || "copy"
              }
              data={data}
              departmentId={departmentId}
              shift={editor}
              week={week}
              date={shiftDate || week}
              onSave={async (op) => {
                await commitChanges([op]);
                setEditor(null);
              }}
              onDelete={async () => {
                if (editor !== true) {
                  await commitChanges([{ kind: "delete", id: editor.id }]);
                  setEditor(null);
                }
              }}
              onCopy={(shift) => {
                const day = localDate(shift.starts_at);
                const next =
                  addDays(day, 1) > addDays(week, 6) ? day : addDays(day, 1);
                setEditor({
                  ...shift,
                  id: "",
                  employee_id: null,
                  ...interval(next, time(shift.starts_at), time(shift.ends_at)),
                });
              }}
            />
          ) : (
            <p>
              הסידור סגור לעריכה. מנהל ראשי יכול לפתוח אותו בכפתור „פתיחה
              לעריכה”.
            </p>
          )}
        </Modal>
      )}
      {entity && (
        <Modal title={entity.title} close={() => setEntity(null)}>
          <EntityForm
            fields={entity.fields}
            initial={entity.initial}
            onSubmit={saveEntity}
          />
        </Modal>
      )}
      {preview && (
        <Modal
          title="בדיקת שינוי ואישור"
          close={() =>
            void run(async () => {
              await post("/api/change", { action: "cancel", id: preview.id });
              setPreview(null);
            })
          }
        >
          <p>
            בדיקות ההרשאה, החפיפות והזמינות עברו. בדוק את ההשפעה לפני אישור.
            פערי איוש אינם נחסמים אוטומטית.
          </p>
          <div className="setup-banner">
            <p>
              פערי איוש לפי הדרישות המוגדרות: לפני{" "}
              {gaps.reduce((n, g) => n + g.missing, 0)}, אחרי{" "}
              {previewGaps.reduce((n, g) => n + g.missing, 0)}. משמרות פתוחות
              לאחר השינוי:{" "}
              {previewAssignments.filter((a) => !a.employee_id).length}.
            </p>
          </div>
          {preview.changes.map((c, i) => (
            <div className="preview-change" key={i}>
              <div>
                <small>לפני</small>
                <p>
                  {c.before
                    ? `${name("employees", c.before.employee_id)} · ${localDate(c.before.starts_at)} · ${time(c.before.starts_at)}–${time(c.before.ends_at)}`
                    : "משמרת חדשה"}
                </p>
              </div>
              <ChevronLeft />
              <div>
                <small>אחרי</small>
                <p>
                  {c.after
                    ? `${name("employees", c.after.employee_id)} · ${localDate(c.after.starts_at)} · ${time(c.after.starts_at)}–${time(c.after.ends_at)} · ${name("departments", c.after.department_id)}`
                    : "מחיקה"}
                </p>
              </div>
            </div>
          ))}
          <div className="row">
            <button
              disabled={busy}
              className="primary"
              onClick={() =>
                void run(async () => {
                  await post("/api/change", {
                    action: "confirm",
                    id: preview.id,
                  });
                  setPreview(null);
                  setNotice(
                    demo
                      ? "השינוי נשמר בדפדפן הזה בלבד. לא נשלח עדכון לעובדים."
                      : "השינוי אושר ונשמר. המשתמשים הרלוונטיים יקבלו עדכון.",
                  );
                })
              }
            >
              <Check size={17} />
              אישור וביצוע
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post("/api/change", {
                    action: "cancel",
                    id: preview.id,
                  });
                  setPreview(null);
                })
              }
            >
              ביטול הבקשה
            </button>
          </div>
        </Modal>
      )}
      {!!importRows.length && (
        <Modal title="ייבוא — התאמת עמודות" close={() => setImportRows([])}>
          <p>
            עד 100 שורות. יש להתאים עמודות המכילות מזהי מערכת, תאריך YYYY-MM-DD
            ושעות HH:mm. כל הייבוא יאושר בטרנזקציה אחת.
          </p>
          <div className="form-grid">
            {[
              "department_id",
              "site_id",
              "role_id",
              "employee_id",
              "date",
              "start",
              "end",
            ].map((k) => (
              <label key={k}>
                {k}
                <select
                  value={mapping[k] || ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [k]: e.target.value })
                  }
                >
                  <option value="">בחירת עמודה</option>
                  {Object.keys(importRows[0]).map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <h3>תצוגה מקדימה · {importRows.length} שורות</h3>
          <pre className="import-preview">
            {JSON.stringify(importRows.slice(0, 5), null, 2)}
          </pre>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const ops = importRows.map((r) => {
                  const v = (k: string) => String(r[mapping[k]] || "").trim();
                  return {
                    kind: "create" as const,
                    department_id: v("department_id"),
                    site_id: v("site_id"),
                    role_id: v("role_id"),
                    employee_id: v("employee_id") || null,
                    ...interval(v("date"), v("start"), v("end")),
                  };
                });
                await propose(ops);
                setImportRows([]);
              })
            }
          >
            בדיקת הייבוא והצגת השינויים
          </button>
        </Modal>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <CalendarDays size={28} />
      <p>{text}</p>
    </div>
  );
}
