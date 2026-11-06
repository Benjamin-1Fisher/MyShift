"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
async function post(url: string, body: unknown) {
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
            השינויים כפופים להרשאות ולבדיקות בצד השרת.
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
}: {
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
      onChange={(e) => {
        setSelections(
          Object.fromEntries(new FormData(e.currentTarget)) as Record<
            string,
            string
          >,
        );
      }}
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
                defaultValue={initial?.[f.key] || ""}
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
        {busy ? "בודק…" : "המשך"}
      </button>
    </form>
  );
}
export default function Workspace({ configured }: { configured: boolean }) {
  const [client] = useState(() =>
    configured
      ? createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
      : null,
  );
  const [data, setData] = useState<Data>(empty),
    [userId, setUserId] = useState(""),
    [page, setPage] = useState("dashboard"),
    [week, setWeek] = useState(sunday()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [filter, setFilter] = useState(""),
    [employeeFilter, setEmployeeFilter] = useState(""),
    [siteFilter, setSiteFilter] = useState(""),
    [view, setView] = useState("week"),
    [search, setSearch] = useState("");
  const [template, setTemplate] = useState(""),
    [editor, setEditor] = useState<Assignment | true | null>(null),
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
  }, [client]);
  useEffect(() => {
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
  }, [client, load]);
  const profile = data.profiles.find((p) => p.id === userId),
    isAdmin = profile?.role === "admin",
    canEdit = !!profile && profile.role !== "employee";
  const version = data.schedule_versions.find((v) => v.week_start === week);
  const assigned = data.shift_assignments.filter(
    (a) => a.version_id === version?.id,
  );
  const filtered = assigned.filter(
    (a) =>
      (!filter || a.department_id === filter) &&
      (!employeeFilter || a.employee_id === employeeFilter) &&
      (!siteFilter || a.site_id === siteFilter),
  );
  const gaps = shortages({ ...data, shift_assignments: assigned }, week);
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
  const propose = async (operations: Operation[]) => {
    const vid =
      version?.id || (await post("/api/change", { action: "create", week }));
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
  const dep = selectField("department_id", "מחלקה", data.departments),
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

  const assignmentFields = [
    dep,
    site,
    role,
    selectField(
      "employee_id",
      "עובד (אפשר להשאיר פתוח)",
      data.employees,
      false,
    ),
    { key: "date", label: "תאריך", type: "date" },
    { key: "start", label: "התחלה", type: "time" },
    { key: "end", label: "סיום", type: "time" },
  ];
  const previewAssignments = preview
    ? assigned
        .filter((a) => !preview.changes.some((c) => c.before?.id === a.id))
        .concat(preview.changes.flatMap((c) => (c.after ? [c.after] : [])))
    : assigned;
  const previewGaps = shortages(
    { ...data, shift_assignments: previewAssignments },
    week,
  );
  const chosenTemplate = data.shift_templates.find(
    (t) => t.id === template && t.confirmed,
  );
  const initialShift: Record<string, string> =
    typeof editor === "object" && editor
      ? {
          department_id: editor.department_id,
          site_id: editor.site_id,
          role_id: editor.role_id,
          employee_id: editor.employee_id || "",
          date: localDate(editor.starts_at),
          start: time(editor.starts_at),
          end: time(editor.ends_at),
        }
      : {
          date: week,
          site_id: data.sites.length === 1 ? data.sites[0].id : "",
          role_id: data.roles.length === 1 ? data.roles[0].id : "",
          start: chosenTemplate
            ? String(chosenTemplate.start_time).slice(0, 5)
            : "07:00",
          end: chosenTemplate
            ? String(chosenTemplate.end_time).slice(0, 5)
            : "15:00",
          department_id: chosenTemplate
            ? String(chosenTemplate.department_id)
            : data.departments.length === 1
              ? data.departments[0].id
              : "",
        };
  const renderCard = (a: Assignment) => (
    <button
      key={a.id}
      className={`shift ${!a.employee_id ? "open" : ""}`}
      style={{
        borderInlineStartColor: String(
          data.departments.find((d) => d.id === a.department_id)?.color ||
            "#8173cf",
        ),
      }}
      draggable={canEdit && version?.status === "draft"}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)}
      onClick={() => setEditor(a)}
    >
      <span className="shift-time" dir="ltr">
        {time(a.starts_at)} – {time(a.ends_at)}
      </span>
      <strong>
        {a.employee_id ? name("employees", a.employee_id) : "דרוש שיבוץ"}
      </strong>
      <small>
        {name("departments", a.department_id)} · {name("sites", a.site_id)}
      </small>
      <small>
        {name("roles", a.role_id)}
        {localDate(a.ends_at) !== localDate(a.starts_at) ? " · למחרת" : ""}
      </small>
    </button>
  );
  if (!userId)
    return (
      <main className="connection-page">
        <section className="connection-card">
          <h1>כניסה ל־MyShift</h1>
          <p>התחבר לחשבון הארגון כדי לנהל עובדים וסידורי עבודה.</p>
          <EntityForm
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
        </section>
      </main>
    );
  return (
    <div className="app">
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
          {nav.map(([key, label, Icon]) => (
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
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>הכול במקום אחד.</strong>
          <p>הצוות, המשמרות והשינויים — מסונכרנים וברורים.</p>
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
              onClick={() => void client?.auth.signOut()}
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
              {userId ? "רענון אוטומטי · כל 10 שניות" : "סביבת עבודה חדשה"}
            </span>
            <button
              aria-label="התראות"
              onClick={() => setPage("notifications")}
            >
              <Bell size={19} />
            </button>
          </div>
        </header>
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
              {canEdit && !version && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post("/api/change", { action: "create", week });
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
                  disabled={busy}
                  onClick={() => {
                    setPage("schedule");
                    setEditor(true);
                  }}
                >
                  <Plus size={17} />
                  הוספת משמרת
                </button>
              )}
            </div>
          </div>
          {!configured && (
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
          {page === "dashboard" && (
            <>
              <div className="stats">
                {[
                  [
                    CalendarDays,
                    "משמרות השבוע",
                    assigned.length,
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
                    assigned.filter((a) => !a.employee_id).length,
                    "ממתינות לשיבוץ",
                  ],
                  [
                    ShieldCheck,
                    "פערי איוש",
                    gaps.reduce((s, g) => s + g.missing, 0),
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
                        const shifts = assigned.filter(
                          (a) => a.department_id === d.id,
                        );
                        return (
                          <button
                            className="department-card"
                            key={d.id}
                            onClick={() => {
                              setFilter(d.id);
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
                  <span className="badge">{gaps.length} פערים</span>
                </div>
                {gaps.length ? (
                  gaps.map((g, i) => (
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
                      {week} — {addDays(week, 6)}
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
                          : "טרם נוצר"}
                    </span>
                  </div>
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
                </div>
                <div className="toolbar filters">
                  <div className="row">
                    <select
                      aria-label="מחלקה"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="">כל המחלקות</option>
                      {data.departments.map((d) => (
                        <option value={d.id} key={d.id}>
                          {String(d.name)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="עובד"
                      value={employeeFilter}
                      onChange={(e) => setEmployeeFilter(e.target.value)}
                    >
                      <option value="">כל העובדים</option>
                      {data.employees.map((d) => (
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
                    {canEdit && !version && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await post("/api/change", {
                              action: "create",
                              week,
                            });
                          })
                        }
                      >
                        יצירת טיוטה
                      </button>
                    )}
                    {isAdmin && version && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await post("/api/change", {
                              action:
                                version.status === "published"
                                  ? "reopen"
                                  : "publish",
                              week,
                            });
                            setNotice("מצב הסידור עודכן");
                          })
                        }
                      >
                        {version.status === "published"
                          ? "פתיחה מחדש"
                          : "פרסום סידור"}
                      </button>
                    )}
                  </div>
                </div>
                {view === "week" ? (
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
                            {filtered
                              .filter((a) => localDate(a.starts_at) === day)
                              .sort((a, b) =>
                                a.starts_at.localeCompare(b.starts_at),
                              )
                              .map(renderCard)}
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
                          {data.shift_assignments
                            .filter(
                              (a) =>
                                localDate(a.starts_at) === day &&
                                (!filter || a.department_id === filter) &&
                                (!siteFilter || a.site_id === siteFilter) &&
                                (!employeeFilter ||
                                  a.employee_id === employeeFilter),
                            )
                            .map(renderCard)}
                        </div>
                      ))}
                  </div>
                ) : (
                  data.employees
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
                    <i className="dot" /> גרירה יוצרת תצוגה מקדימה לאישור
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
              <table>
                <thead>
                  <tr>
                    <th>עובד</th>
                    <th>מחלקות והכשרות</th>
                    <th>מצב</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees
                    .filter((e) => String(e.name).includes(search))
                    .map((e) => (
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
                            {e.active ? "פעיל" : "לא פעיל"}
                          </span>
                        </td>
                        <td>
                          {isAdmin && (
                            <div className="row">
                              <button
                                onClick={() =>
                                  openEntity(
                                    "employee",
                                    "עריכת עובד",
                                    [
                                      { key: "name", label: "שם" },
                                      {
                                        key: "user_id",
                                        label: "מזהה משתמש",
                                        required: false,
                                      },
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
              {data.availability.map((a) => (
                <div className="list-row" key={a.id}>
                  {name("employees", a.employee_id)} · {String(a.kind)} ·{" "}
                  {String(a.starts_at)} — {String(a.ends_at)}
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
                    <strong>{String(d.name)}</strong>
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
                          ],
                          {
                            id: d.id,
                            name: String(d.name),
                            color: String(d.color),
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
                <span className="ai-star"><Sparkles /></span>
                <h2>עוזר AI — בקרוב</h2>
                <p className="muted">העוזר אינו פעיל כרגע. אפשר לנהל עובדים ומשמרות באופן ידני לאחר חיבור מסד הנתונים.</p>
              </div>
              <div className="chat-input">
                <input disabled placeholder="בקרוב" aria-label="בקשה לעוזר" />
                <button className="primary" disabled>בקרוב <Sparkles size={16} /></button>
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
              {isAdmin && (
                <div className="action-grid">
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
                </div>
              )}
              <h3>תבניות משמרת</h3>
              {data.shift_templates.map((t) => (
                <div className="list-row" key={t.id}>
                  <strong>{String(t.name)}</strong>
                  <span>
                    {name("departments", t.department_id)} ·{" "}
                    {t.confirmed
                      ? `${t.start_time}–${t.end_time}`
                      : "שעות לא מאומתות — אין להשתמש לשיבוץ"}
                  </span>
                  {isAdmin && (
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
              {data.coverage_requirements.map((c) => (
                <div className="list-row" key={c.id}>
                  {name("departments", c.department_id)} ·{" "}
                  {days[Number(c.weekday)]} · {String(c.start_time)}–
                  {String(c.end_time)} · {String(c.required_count)} עובדים
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
      {editor && (
        <Modal
          title={editor === true ? "הוספת משמרת" : "פרטי משמרת"}
          close={() => setEditor(null)}
        >
          {canEdit && (!version || version.status === "draft") ? (
            <>
              <p className="muted">
                סיום מוקדם משעת ההתחלה פירושו סיום ביום הבא. משמרת ללא עובד
                תישאר פתוחה.
              </p>
              {data.shift_templates.some((t) => t.confirmed) && (
                <p className="muted">
                  תבניות מאומתות:{" "}
                  {data.shift_templates
                    .filter((t) => t.confirmed)
                    .map((t) => `${t.name} ${t.start_time}–${t.end_time}`)
                    .join(" · ")}
                </p>
              )}
              {editor === true && (
                <label>
                  תבנית מאומתת
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                  >
                    <option value="">שעות מותאמות</option>
                    {data.shift_templates
                      .filter((t) => t.confirmed)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {String(t.name)} ·{" "}
                          {name("departments", t.department_id)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <EntityForm
                key={template}
                fields={assignmentFields}
                initial={initialShift}
                onSubmit={async (v) => {
                  await propose([
                    {
                      kind: editor === true ? "create" : "update",
                      ...(editor === true ? {} : { id: editor.id }),
                      department_id: v.department_id,
                      site_id: v.site_id,
                      role_id: v.role_id,
                      employee_id: v.employee_id || null,
                      ...interval(v.date, v.start, v.end),
                    } as Operation,
                  ]);
                  setEditor(null);
                }}
              />
              {editor !== true && (
                <button
                  className="danger"
                  onClick={() =>
                    void run(async () => {
                      await propose([{ kind: "delete", id: editor.id }]);
                      setEditor(null);
                    })
                  }
                >
                  מחיקת משמרת…
                </button>
              )}
            </>
          ) : (
            <p>
              נדרשת הרשאת עריכה וסידור במצב טיוטה.{" "}
              {editor !== true &&
                `${name("employees", editor.employee_id)} · ${time(editor.starts_at)}–${time(editor.ends_at)}`}
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
                    "השינוי אושר ונשמר. המשתמשים הרלוונטיים יקבלו עדכון.",
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
