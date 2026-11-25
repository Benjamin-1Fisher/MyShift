"use client";
import Link from "next/link";
import ShiftEditor from "./shift-editor";
import WeeklyAvailabilityEditor from "./weekly-availability-editor";
import ScheduleNotifications from "./schedule-notifications";
import OrganizationWeek, { type BoardView } from "./organization-week";
import DepartmentSelect from "./department-select";
import ShiftCard from "./shift-card";
import DemoTeamDesk from "./demo-team-desk";
import ScheduleSettings from "./schedule-settings";
import PublicationReview from "./publication-review";
import type {
  PersonalSchedule,
  PublicationReview as Review,
  ScheduleChange,
  UndoWeeklyPlan,
  WeeklyPlanResult,
} from "@/lib/weekly-schedule";
import managementStyles from "./workspace-management.module.css";
import { buildDepartmentOverview, type ScheduleFocus } from "@/lib/overview";
import {
  absenceReasons,
  absencesForWeek,
  absenceDate,
  absenceEndDay,
  absenceLabel,
  isWholeDayAbsence,
} from "@/lib/absences";
import { scheduleNotices } from "@/lib/schedule-notifications";
import {
  normalizeWeeklyAvailability,
  weeklyAvailabilitySchema,
  weeklyAvailabilitySummary,
  type WeeklyAvailability,
} from "@/lib/weekly-availability";
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
  CalendarDays,
  Users,
  Building2,
  Bell,
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
  Check,
  X,
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
  changes: ScheduleChange[];
};
const emptyPersonal: PersonalSchedule = { schedule_versions: [], shift_assignments: [] };

function reverseChanges(changes: ScheduleChange[]): Operation[] {
  return [...changes].reverse().map(({ before, after }) =>
    before
      ? { ...before, kind: after ? "update" : "create" }
      : { kind: "delete", id: after!.id },
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Row[];
  required?: boolean;
  dependsOn?: string;
  optionParent?: string;
  wide?: boolean;
};
type ScheduleScope = {
  week: string;
  departmentId: string;
  versionId?: string;
  revision: number;
};
type ShiftDialog = {
  shift: Assignment | true;
  scope: ScheduleScope;
  date: string;
  generation: number;
};
const boardDefault: BoardView = { day: "", filter: "all", departmentId: "" };
const settingsPages = [
  ["settings", "כללי סידור"],
  ["departments", "מבנה הארגון"],
  ["history", "יומן פעילות"],
] as const;
const empty = Object.fromEntries(tables.map((t) => [t, []])) as unknown as Data;
const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const time = (v: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(value + "T12:00:00Z"));
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
  shiftDialog = false,
  restoreFocus,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  shiftDialog?: boolean;
  restoreFocus?: () => boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={shiftDialog ? "modal workspace-shift-dialog" : "modal"}
          onOpenAutoFocus={(event) => {
            if (!shiftDialog) return;
            const field = document.querySelector<HTMLElement>(
              ".workspace-shift-dialog [data-shift-initial-focus]",
            );
            if (!field) return;
            event.preventDefault();
            field.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (restoreFocus?.()) event.preventDefault();
          }}
        >
          <div className="row between">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="סגירה">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className={shiftDialog ? "sr-only" : "muted"}>
            {shiftDialog
              ? "עדכון העובד ופרטי המשמרת"
              : "בדקו את פרטי השינוי לפני האישור."}
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
  employeeForm = false,
  initialAvailability,
  note,
}: {
  submitLabel?: string;
  fields: Field[];
  initial?: Record<string, string>;
  onSubmit: (v: Record<string, string>) => Promise<void>;
  employeeForm?: boolean;
  initialAvailability?: unknown;
  note?: string;
}) {
  const [selections, setSelections] = useState<Record<string, string>>(
    initial || {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [originalAvailability] = useState<WeeklyAvailability>(() => {
    const parsed = weeklyAvailabilitySchema.safeParse(
      initialAvailability ?? null,
    );
    return parsed.success ? normalizeWeeklyAvailability(parsed.data) : null;
  });
  const [weeklyAvailability, setWeeklyAvailability] =
    useState(originalAvailability);
  return (
    <form
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const values = Object.fromEntries(
            new FormData(e.currentTarget),
          ) as Record<string, string>;
          if (
            employeeForm &&
            JSON.stringify(weeklyAvailability) !==
              JSON.stringify(originalAvailability)
          ) {
            const parsed =
              weeklyAvailabilitySchema.safeParse(weeklyAvailability);
            if (!parsed.success)
              throw new Error("יש לבחור לפחות משמרת אחת או לבחור הכול");
            values.weekly_availability = JSON.stringify(
              normalizeWeeklyAvailability(parsed.data),
            );
          }
          await onSubmit(values);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {note && <p className="muted form-note">{note}</p>}
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key} className={f.wide ? "field-wide" : undefined}>
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
      {employeeForm && (
        <WeeklyAvailabilityEditor
          value={weeklyAvailability}
          onChange={setWeeklyAvailability}
          disabled={busy}
        />
      )}
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
  const initialViewRead = useRef(false);
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
    [selectedPage, setPage] = useState<string | null>(null),
    [week, setSelectedWeek] = useState(sunday()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [filter, setFilter] = useState(""),
    [employeeFilter, setEmployeeFilter] = useState(""),
    [roleFilter, setRoleFilter] = useState(""),
    [absenceFilter, setAbsenceFilter] = useState(""),
    [siteFilter, setSiteFilter] = useState(""),
    [view, setView] = useState("week"),
    [search, setSearch] = useState("");
  const [scheduleFocus, setScheduleFocus] = useState<ScheduleFocus>("all");
  const [personal, setPersonal] = useState<PersonalSchedule>(emptyPersonal);
  const [publication, setPublication] = useState<{
    week: string;
    weekRange: string;
    departmentId?: string;
    rows: Review[] | null;
    error: string;
  } | null>(null);
  const publicationRequest = useRef(0);
  const publicationTrigger = useRef<HTMLElement | null>(null);
  const [boardView, setBoardView] = useState<BoardView>(boardDefault);
  useEffect(() => {
    if (!menu) return;
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenu(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [menu]);
  const boardPosition = useRef<{
    top: number;
    left: number;
    tableTop: number;
  } | null>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const editorBusy = useRef(false);
  const [lastUndo, setLastUndo] = useState<UndoWeeklyPlan | {
    scope: ScheduleScope;
    operations: Operation[];
  } | null>(null);
  const [archivePrompt, setArchivePrompt] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<string | null>(null);
  const [editor, setEditor] = useState<ShiftDialog | null>(null),
    [entity, setEntity] = useState<{
      kind: string;
      title: string;
      fields: Field[];
      initial?: Record<string, string>;
    } | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [importRows, setImportRows] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const setWeek = (date: string) => {
    setSelectedWeek(date);
    const url = new URL(window.location.href);
    url.searchParams.set("week", date);
    window.history.replaceState(null, "", url);
  };
  const load = useCallback(async () => {
    const query = new URLSearchParams(window.location.search);
    setFilter(query.get("department") || "");
    const requestedWeek = query.get("week");
    const linkedWeek =
      requestedWeek &&
      /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) &&
      Number.isFinite(Date.parse(requestedWeek + "T12:00:00Z"))
        ? sunday(new Date(requestedWeek + "T12:00:00Z"))
        : null;
    if (!initialViewRead.current) {
      initialViewRead.current = true;
      if (query.get("view") === "department") setPage("schedule");
      if (linkedWeek) setSelectedWeek(linkedWeek);
    }
    if (demo) {
      const { loadDemoWorkspace, DEMO_ADMIN } = await import("@/lib/demo");
      const { data: saved, personal } = loadDemoWorkspace();
      if (
        !demoLoaded.current &&
        !linkedWeek &&
        !saved.schedule_versions.some((v) => v.week_start === sunday())
      ) {
        const latest = saved.schedule_versions
          .map((v) => String(v.week_start))
          .sort()
          .at(-1);
        if (latest) {
          setSelectedWeek(latest);
          setNotice(
            "מוצג השבוע האחרון שנשמר בהדגמה. אפשר לעבור לשבוע הנוכחי וליצור סידור חדש.",
          );
        }
      }
      demoLoaded.current = true;
      setData(saved);
      setPersonal(personal);
      setUserId(DEMO_ADMIN);
      setDemoReady(true);
      return saved;
    }
    if (!client) return;
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.status === 401) {
      setUserId("");
      setData(empty);
      setPersonal(emptyPersonal);
      return;
    }
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setData(result.data);
    setPersonal(result.personal || emptyPersonal);
    setUserId(result.userId);
    return result.data as Data;
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
  const profile = demoEmployee
      ? {
          id: demoEmployee,
          name: data.employees.find((e) => e.id === demoEmployee)?.name,
          role: "employee",
        }
      : data.profiles.find((p) => p.id === userId),
    isAdmin = profile?.role === "admin",
    canEdit = !!profile && profile.role !== "employee";
  const page =
    !canEdit && selectedPage === "organization"
      ? "schedule"
      : (selectedPage ?? (canEdit ? "organization" : "schedule"));
  const teamActive = page === "employees" || page === "team-desk";
  const settingsActive = settingsPages.some(([key]) => key === page);
  const managementPage = teamActive || (canEdit && settingsActive);
  const departmentSchedule = canEdit && page === "schedule";
  const pageLabel =
    page === "schedule"
      ? canEdit
        ? "שיבוץ מחלקה"
        : "המשמרות שלי"
      : page === "organization"
        ? "סידור עבודה"
        : page === "notifications"
          ? "התראות"
          : teamActive
            ? canEdit
              ? "צוות"
              : "הפרופיל שלי"
            : "הגדרות";
  useEffect(() => {
    if (page !== "organization" || !boardPosition.current) return;
    const position = boardPosition.current;
    boardPosition.current = null;
    window.scrollTo({ top: position.top, behavior: "instant" });
    document.querySelector(".org-desktop")?.scrollTo({
      left: position.left,
      top: position.tableTop,
      behavior: "instant",
    });
  }, [page]);
  const unreadNotices = scheduleNotices(data.notifications).filter(
    (n) => !n.read,
  ).length;
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
  const managementDepartment =
    (page === "employees" || page === "settings") && departments.length > 0;
  const personalEmployeeId =
    demoEmployee || data.employees.find((e) => e.user_id === userId)?.id;
  const displayData = canEdit ? data : {
    ...personal,
    shift_assignments: personal.shift_assignments.filter((a) => a.employee_id === personalEmployeeId),
  };
  const departmentMemberships = data.employee_departments.filter(
    (membership) => membership.department_id === departmentId,
  );
  const departmentEmployeeIds = new Set(
    departmentMemberships.map((membership) => membership.employee_id),
  );
  const departmentEmployees = data.employees.filter(
    (e) =>
      (canEdit || e.id === personalEmployeeId) &&
      departmentEmployeeIds.has(e.id),
  );
  const weekAbsences = absencesForWeek(data.availability, week);
  const absentEmployees = new Set(weekAbsences.map((a) => a.employee_id));
  const absentInWeek = (id: string) => absentEmployees.has(id);
  const mayManageAbsence = (employee: Row) =>
    isAdmin ||
    employee.user_id === userId ||
    employee.id === demoEmployee ||
    (canEdit &&
      data.employee_departments.some(
        (m) =>
          m.employee_id === employee.id &&
          departments.some((d) => d.id === m.department_id),
      ) &&
      data.employee_departments
        .filter((m) => m.employee_id === employee.id)
        .every((m) => departments.some((d) => d.id === m.department_id)));
  const employeeQuery = search.trim().toLocaleLowerCase("he-IL");
  const activeEmployeeFilters = Boolean(
    employeeQuery || roleFilter || siteFilter || absenceFilter,
  );
  const roleEmployees = roleFilter
    ? new Set(
        departmentMemberships
          .filter((m) => m.role_id === roleFilter)
          .map((m) => m.employee_id),
      )
    : null;
  const siteEmployees =
    page === "employees" && siteFilter
      ? new Set<Assignment["employee_id"]>()
      : null;
  if (siteEmployees) {
    const endOfWeek = addDays(week, 6);
    for (const shift of data.shift_assignments) {
      if (shift.site_id !== siteFilter) continue;
      const day = localDate(shift.starts_at);
      if (day >= week && day <= endOfWeek) siteEmployees.add(shift.employee_id);
    }
  }
  const visibleEmployees =
    page === "employees"
      ? departmentEmployees.filter(
          (e) =>
            String(e.name).toLocaleLowerCase("he-IL").includes(employeeQuery) &&
            (!roleEmployees || roleEmployees.has(e.id)) &&
            (!siteEmployees || siteEmployees.has(e.id)) &&
            (!absenceFilter ||
              absentInWeek(e.id) === (absenceFilter === "absent")),
        )
      : [];
  const visibleEmployeesById = new Map(
    visibleEmployees.map((employee) => [employee.id, employee]),
  );
  const employeeMemberships = new Map<string, Row[]>();
  if (page === "employees") {
    for (const membership of data.employee_departments) {
      const employeeId = String(membership.employee_id);
      if (!visibleEmployeesById.has(employeeId)) continue;
      const memberships = employeeMemberships.get(employeeId);
      if (memberships) memberships.push(membership);
      else employeeMemberships.set(employeeId, [membership]);
    }
  }
  const clearEmployeeFilters = () => {
    setSearch("");
    setRoleFilter("");
    setSiteFilter("");
    setAbsenceFilter("");
  };
  const visibleAbsences = weekAbsences.filter((absence) =>
    visibleEmployeesById.has(String(absence.employee_id)),
  );
  const weekStart = Date.parse(civilTime(week, "00:00"));
  const weekEnd = Date.parse(civilTime(addDays(week, 7), "00:00"));
  const finalDay = addDays(week, 6);
  const weekStartLabel = absenceDate(week);
  const sameYear = week.slice(0, 4) === finalDay.slice(0, 4);
  const weekRange = `${sameYear ? weekStartLabel.slice(0, -5) : weekStartLabel}–${absenceDate(finalDay)}`;
  const visibleAvailability =
    page === "employees"
      ? data.availability.filter(
          (record) =>
            record.kind === "available" &&
            Date.parse(String(record.starts_at)) < weekEnd &&
            Date.parse(String(record.ends_at)) > weekStart &&
            visibleEmployeesById.has(String(record.employee_id)),
        )
      : [];
  const openOrganization = () => {
    setPage("organization");
    setMenu(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };
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
    setAbsenceFilter("");
    setScheduleFocus("all");
  };
  const openDepartmentSchedule = (id: string, targetWeek = week) => {
    if (page === "organization") {
      const table = document.querySelector(".org-desktop");
      boardPosition.current = {
        top: window.scrollY,
        left: table?.scrollLeft || 0,
        tableTop: table?.scrollTop || 0,
      };
    }
    selectDepartment(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "department");
    url.searchParams.set("week", targetWeek);
    window.history.replaceState(null, "", url);
    setSelectedWeek(targetWeek);
    setView("week");
    setPage("schedule");
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
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
  const version = displayData.schedule_versions.find(
    (v) =>
      v.week_start === week &&
      v.department_id === departmentId &&
      v.status !== "archived",
  );
  const scope: ScheduleScope = {
    week,
    departmentId,
    versionId: version?.id,
    revision: Number(version?.revision || 0),
  };
  const openShift = (shift: Assignment | true, date = week) => {
    if (!canEdit || busy) return;
    const target =
      shift === true
        ? version
        : data.schedule_versions.find((v) => v.id === shift.version_id);
    if (
      (shift !== true && target?.status !== "draft") ||
      target?.status === "published"
    )
      return;
    editorTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditor({
      shift,
      scope:
        shift === true
          ? scope
          : {
              week: String(target!.week_start),
              departmentId: shift.department_id,
              versionId: target!.id,
              revision: Number(target!.revision),
            },
      date,
      generation: 0,
    });
  };
  const assigned = displayData.shift_assignments.filter(
    (a) =>
      a.version_id === version?.id &&
      (canEdit ||
        (version.status === "published" &&
          a.employee_id === personalEmployeeId)),
  );
  const conflicts = assigned.filter(
    (a) => a.employee_id && !canAssign(data, a, a.employee_id),
  );
  const filtered = assigned.filter(
    (a) =>
      a.department_id === departmentId &&
      (scheduleFocus === "all" ||
        (scheduleFocus === "open"
          ? !a.employee_id
          : conflicts.some((c) => c.id === a.id))) &&
      (!employeeFilter || a.employee_id === employeeFilter) &&
      (!siteFilter || a.site_id === siteFilter) &&
      (!roleFilter || a.role_id === roleFilter),
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
  const scheduleOverview =
    canEdit && page === "schedule" && departmentId
      ? buildDepartmentOverview(
          data,
          week,
          departments.filter((d) => d.id === departmentId),
        )[0]
      : undefined;
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
    target: ScheduleScope = scope,
  ) => {
    if (!operations.length) {
      setNotice("הסידור כבר מעודכן. לא נדרשו שינויים.");
      return;
    }
    const observed = data.schedule_versions.find(
      (v) =>
        v.week_start === target.week &&
        v.department_id === target.departmentId &&
        v.status !== "archived",
    );
    if (
      (target.versionId &&
        (observed?.id !== target.versionId ||
          observed.status !== "draft" ||
          Number(observed.revision) !== target.revision)) ||
      (!target.versionId && observed)
    ) {
      throw new Error(
        "הסידור השתנה מאז פתיחת העריכה. טענו את פרטי המשמרת מחדש לפני השמירה.",
      );
    }
    const vid =
      target.versionId ||
      (await post("/api/change", {
        action: "create",
        week: target.week,
        department_id: target.departmentId,
      }));
    const proposed = await post("/api/change", {
      action: "preview",
      version: vid,
      operations,
    });
    let changes: Preview["changes"];
    try {
      if (Number(proposed.revision) !== target.revision) {
        throw new Error(
          "הסידור השתנה. יש לפתוח תצוגה מקדימה חדשה לפני השמירה.",
        );
      }
      changes = (await post("/api/change", {
        action: "confirm",
        id: proposed.id,
      })) as Preview["changes"];
    } catch (error) {
      await post("/api/change", { action: "cancel", id: proposed.id }).catch(
        () => {},
      );
      throw error;
    }
    if (remember && Array.isArray(changes))
      setLastUndo({
        scope: { ...target, versionId: vid, revision: target.revision + 1 },
        operations: reverseChanges(changes),
      });
    await load();
    setNotice(remember ? "השינויים נשמרו" : "הפעולה האחרונה בוטלה");
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
  const openTemplate = (template?: Row) =>
    openEntity(
      "template",
      template ? "עריכת תבנית" : "תבנית משמרת חדשה",
      [
        dep,
        { key: "name", label: "שם" },
        { key: "start_time", label: "התחלה", type: "time", required: false },
        {
          key: "end_time",
          label: template ? "סיום" : "סיום (רק אם אומת)",
          type: "time",
          required: false,
        },
        {
          key: "confirmed",
          label: template ? "מאומת" : "שעות מאומתות",
          options: [
            { id: "false", name: template ? "לא" : "לא מאומת" },
            { id: "true", name: template ? "כן" : "מאומת" },
          ],
        },
      ],
      template &&
        Object.fromEntries(
          Object.entries(template).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        ),
    );
  const openCoverage = (requirement?: Row) =>
    openEntity(
      "coverage",
      requirement ? "עריכת דרישת איוש" : "דרישת איוש",
      [
        dep,
        site,
        role,
        {
          key: "weekday",
          label: "יום",
          options: days.map((name, index) => ({ id: String(index), name })),
        },
        { key: "start_time", label: "התחלה", type: "time" },
        { key: "end_time", label: "סיום", type: "time" },
        { key: "required_count", label: "מספר עובדים", type: "number" },
      ],
      requirement &&
        Object.fromEntries(
          Object.entries(requirement).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        ),
    );
  const openRestRules = () =>
    openEntity(
      "settings",
      "מנוחה ומשך משמרת",
      [
        {
          key: "min_rest_hours",
          label: "שעות מנוחה מינימליות",
          type: "number",
        },
        { key: "max_shift_hours", label: "משך משמרת מרבי", type: "number" },
      ],
      {
        min_rest_hours: String(data.settings[0]?.min_rest_hours ?? 0),
        max_shift_hours: String(data.settings[0]?.max_shift_hours ?? 24),
      },
    );
  const openPermissions = () =>
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
    ]);
  const openAbsence = (employee: Row, record?: Row) => {
    const today = localDate(new Date().toISOString());
    const day = today >= week && today < addDays(week, 7) ? today : week;
    openEntity(
      "absence",
      `חופשות והיעדרויות · ${employee.name}`,
      [
        {
          key: "absence_reason",
          label: "סוג ההיעדרות",
          options: [...absenceReasons],
          wide: true,
        },
        { key: "starts_on", label: "מיום", type: "date" },
        { key: "ends_on", label: "עד יום (כולל)", type: "date" },
      ],
      {
        employee_id: employee.id,
        absence_reason: String(record?.absence_reason || "vacation"),
        starts_on: record ? localDate(String(record.starts_at)) : day,
        ends_on: record ? absenceEndDay(record) : day,
        ...(record ? { id: record.id } : {}),
      },
    );
  };
  const openAvailability = (employee: Row, record?: Row) => {
    const today = localDate(new Date().toISOString());
    const day = today >= week && today < addDays(week, 7) ? today : week;
    const inputValue = (value: unknown, fallback: string) =>
      value
        ? `${localDate(String(value))}T${time(String(value))}`
        : `${day}T${fallback}`;
    openEntity(
      "availability",
      `דיווח זמינות · ${employee.name}`,
      [
        { key: "start", label: "תחילת זמינות", type: "datetime-local" },
        { key: "end", label: "סיום זמינות", type: "datetime-local" },
      ],
      {
        employee_id: employee.id,
        start: inputValue(record?.starts_at, "07:00"),
        end: inputValue(record?.ends_at, "15:00"),
        ...(record ? { id: record.id } : {}),
      },
    );
  };
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
    if (entity.kind === "absence") v.employee_id = entity.initial?.employee_id;
    if (entity.kind === "department") v.active = values.active !== "false";
    if (entity.kind === "employee") {
      v.active = values.active !== "false";
      v.user_id = values.user_id || null;
      if (values.weekly_availability !== undefined)
        v.weekly_availability = JSON.parse(values.weekly_availability);
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
      if (Date.parse(String(v.ends_at)) <= Date.parse(String(v.starts_at)))
        throw new Error("סוף חלון הזמינות צריך להיות אחרי ההתחלה.");
      v.employee_id = entity.initial?.employee_id;
      v.kind = "available";
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
    if (entity.kind === "absence" || entity.kind === "availability") {
      const day =
        entity.kind === "absence"
          ? values.starts_on
          : values.start.slice(0, 10);
      setWeek(sunday(new Date(day + "T12:00:00Z")));
      setAbsenceFilter("");
    }
    setEntity(null);
    await load();
    setNotice(
      entity.kind === "absence"
        ? "ההיעדרות נשמרה ותילקח בחשבון בשיבוץ."
        : entity.kind === "employee"
          ? values.weekly_availability !== undefined && entity.initial?.id
            ? "העובד והזמינות נשמרו. שיבוצים קיימים נשארו ללא שינוי ויופיעו לבדיקה אם נדרש."
            : "העובד נשמר ומוכן לשיבוץ"
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
  const isPublished = version?.status === "published";
  const openCount = scheduleOverview?.open ?? 0;
  const creationBlock =
    scheduleOverview?.issue ||
    (!scheduleOverview?.configured ? "יש להגדיר ולאמת שעות במחלקה" : "");
  const fillBlock = !openCount
    ? "אין משמרות פנויות"
    : assigned.some(
          (shift) =>
            !shift.employee_id &&
            departmentEmployees.some((employee) =>
              canAssign(data, shift, employee.id),
            ),
        )
      ? ""
      : "אין עובדים זמינים למשמרות הפנויות";
  const publishBlock = conflicts.length
    ? "יש לתקן את השיבוצים שדורשים בדיקה"
    : "";
  const plan = (mode: "generate" | "fill" | "open") =>
    void run(() => commitChanges(planWeek(data, week, mode, departmentId)));
  function loadPublication(target: NonNullable<typeof publication>) {
    const request = ++publicationRequest.current;
    setPublication({ ...target, rows: null, error: "" });
    void post("/api/change", { action: "review_weekly_publication", week: target.week })
      .then((rows: Review[]) => {
        if (request !== publicationRequest.current) return;
        setPublication({
          ...target,
          rows: rows.filter((row) => !target.departmentId || row.department_id === target.departmentId),
          error: "",
        });
      })
      .catch((cause: Error) => {
        if (request === publicationRequest.current)
          setPublication({ ...target, rows: null, error: cause.message });
      });
  }
  function openPublication(targetDepartment?: string) {
    publicationTrigger.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    loadPublication({ week, weekRange, departmentId: targetDepartment, rows: null, error: "" });
  }
  const updatePublication = () =>
    isPublished
      ? void run(async () => {
          await post("/api/change", { action: "reopen", week, department_id: departmentId });
          setLastUndo(null);
          setNotice("הטיוטה פתוחה לעריכה. העובדים רואים את הסידור האחרון שפורסם.");
        })
      : openPublication(departmentId);
  const primaryAction = isPublished
    ? "reopen"
    : conflicts.length
      ? "review"
      : !assigned.length && creationBlock
        ? "configure"
        : !assigned.length || scheduleOverview?.missing
          ? "generate"
          : !fillBlock
            ? "fill"
            : "publish";
  const primaryLabels = {
    reopen: "פתיחה לעריכה",
    review: "בדיקת שיבוצים",
    configure: "הגדרת שעות",
    generate: assigned.length ? "השלמת משמרות" : "יצירת סידור",
    fill: "שיבוץ אוטומטי",
    publish: "פרסום סידור",
  };
  function runPrimaryAction() {
    switch (primaryAction) {
      case "review":
        setView("week");
        setScheduleFocus("conflicts");
        break;
      case "configure":
        setPage("settings");
        break;
      case "generate":
      case "fill":
        plan(primaryAction);
        break;
      default:
        updatePublication();
    }
  }
  const canUndo =
    !!lastUndo &&
    notice === "השינויים נשמרו" &&
    (page === "organization" || page === "schedule") &&
    ("targets" in lastUndo
      ? lastUndo.targets.every((target) => data.schedule_versions.some(
          (row) => row.id === target.version_id && row.status === "draft" && Number(row.revision) === target.revision,
        ))
      : data.schedule_versions.some(
          (row) => row.id === lastUndo.scope.versionId && row.status === "draft",
        ));
  const [personalClock, setPersonalClock] = useState(() => Date.now());
  useEffect(() => {
    if (canEdit) return;
    const timer = window.setInterval(() => setPersonalClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [canEdit]);
  const nextPersonalShift =
    !canEdit && personalEmployeeId
      ? displayData.shift_assignments
          .filter(
            (shift) =>
              shift.employee_id === personalEmployeeId &&
              Date.parse(shift.ends_at) > personalClock,
          )
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
      : undefined;
  const renderCard = (shift: Assignment) => (
    <ShiftCard
      key={shift.id}
      shift={shift}
      employeeName={
        shift.employee_id ? name("employees", shift.employee_id) : undefined
      }
      siteName={name("sites", shift.site_id)}
      roleName={name("roles", shift.role_id)}
      color={String(
        data.departments.find((d) => d.id === shift.department_id)?.color ||
          "#8173cf",
      )}
      conflict={
        canEdit &&
        !!shift.employee_id &&
        !canAssign(data, shift, shift.employee_id)
      }
      onEdit={
        canEdit &&
        data.schedule_versions.some(
          (v) => v.id === shift.version_id && v.status === "draft",
        )
          ? () => openShift(shift)
          : undefined
      }
    />
  );
  if (!userId)
    return (
      <main className="connection-page">
        <section className="connection-card">
          <h1>{demo ? "טוענים את ההדגמה" : "כניסה ל־MyShift"}</h1>
          {demo ? (
            <>
              <p role={error ? "alert" : "status"}>
                {error || "מכינים את לוח העבודה המקומי…"}
              </p>
              <p>הלוח לא נפתח? אפשר לטעון מחדש בלי לאפס את השיבוצים השמורים.</p>
              <p>
                {/* A native same-page link works even if the client bundle has not loaded. */}
                <a className="button" href="">
                  טעינת ההדגמה מחדש
                </a>
              </p>
              <noscript>
                <p>הצגת הלוח דורשת JavaScript.</p>
              </noscript>
            </>
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
  const demoControls = demo && demoReady && (
    <div className="demo-banner" role="region" aria-label="מצב הדגמה">
      <label className="demo-view-label">
        <span className="demo-mode-label">דמו</span>
        <select
          aria-label="תצוגת הדגמה"
          value={demoEmployee}
          onChange={(e) => {
            setDemoEmployee(e.target.value);
            if (page === "team-desk") setPage("team-desk");
            else if (e.target.value) setPage("schedule");
            else openOrganization();
            setFilter("");
            setEmployeeFilter("");
            setSiteFilter("");
            setScheduleFocus("all");
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
  );
  const sidebarBrand = (
    <Link className="brand" href="/" onClick={() => setMenu(false)}>
      <span className="brand-icon">
        <ShieldCheck />
      </span>
      MyShift<span className="brand-dot">.</span>
    </Link>
  );
  const sidebarContent = (
    <>
      <nav aria-label="ניווט ראשי">
        <button
          className={
            page === "organization" || page === "schedule"
              ? "nav-item active"
              : "nav-item"
          }
          aria-current={
            page === "organization" || page === "schedule" ? "page" : undefined
          }
          onClick={() => {
            if (canEdit) openOrganization();
            else {
              setPage("schedule");
              setMenu(false);
            }
          }}
        >
          <CalendarDays size={19} aria-hidden />{" "}
          {canEdit ? "סידור עבודה" : "המשמרות שלי"}
        </button>
        <button
          className={teamActive ? "nav-item active" : "nav-item"}
          aria-current={teamActive ? "page" : undefined}
          onClick={() => {
            setPage("employees");
            setMenu(false);
          }}
        >
          <Users size={19} aria-hidden /> {canEdit ? "צוות" : "הפרופיל שלי"}
        </button>
        {canEdit && (
          <button
            className={settingsActive ? "nav-item active" : "nav-item"}
            aria-current={settingsActive ? "page" : undefined}
            onClick={() => {
              setPage("settings");
              setMenu(false);
            }}
          >
            <Settings size={19} aria-hidden /> הגדרות
          </button>
        )}
      </nav>
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
              setMenu(false);
              if (demo) router.push("/");
              else void client?.auth.signOut();
            }}
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </>
  );
  const workspace = (
    <div className={page === "schedule" ? "app planning" : "app"}>
      <aside className="sidebar">
        {sidebarBrand}
        {sidebarContent}
      </aside>
      <main>
        <header className="topbar">
          <div className="row">
            <Dialog.Root open={menu} onOpenChange={setMenu}>
              <Dialog.Trigger className="mobile-menu" aria-label="תפריט">
                <Menu aria-hidden />
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="workspace-nav-scrim" />
                <Dialog.Content
                  className="sidebar workspace-nav-drawer"
                  aria-describedby={undefined}
                >
                  <Dialog.Title className="sr-only">תפריט ניווט</Dialog.Title>
                  <div className="workspace-nav-heading">
                    {sidebarBrand}
                    <Dialog.Close aria-label="סגירת תפריט">
                      <X size={20} aria-hidden />
                    </Dialog.Close>
                  </div>
                  {sidebarContent}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <strong className="workspace-mobile-brand">MyShift</strong>
          </div>
          <div className="row">
            {!demo && (
              <span className="connection">
                <i className="dot" />
                {userId ? "רענון אוטומטי · כל 10 שניות" : "סביבת עבודה חדשה"}
              </span>
            )}
            <button
              aria-label={
                unreadNotices ? `התראות, ${unreadNotices} חדשות` : "התראות"
              }
              onClick={() => setPage("notifications")}
            >
              <Bell size={19} />
              {unreadNotices > 0 && (
                <span className="notification-count" aria-hidden="true">
                  {unreadNotices}
                </span>
              )}
            </button>
          </div>
        </header>
        <div className="content">
          <div
            className={`workspace-heading ${managementPage ? managementStyles.heading : ""}`}
          >
            <div
              className={`workspace-title ${departmentSchedule ? "workspace-department-title" : ""}`}
            >
              {departmentSchedule && (
                <button
                  className="workspace-back"
                  type="button"
                  aria-label="חזרה לכל המחלקות"
                  title="חזרה לכל המחלקות"
                  onClick={openOrganization}
                >
                  <ChevronRight size={18} aria-hidden />
                  <span>חזרה לכל המחלקות</span>
                </button>
              )}
              {departmentSchedule && departmentId ? (
                <h1 className="sr-only">
                  סידור מחלקת {name("departments", departmentId)}
                </h1>
              ) : (
                <h1>{pageLabel}</h1>
              )}
              {page === "schedule" &&
                departmentId &&
                (canEdit || departments.length > 1) && (
                  <DepartmentSelect
                    departments={departments}
                    value={departmentId}
                    onChange={selectDepartment}
                    label="מחלקה"
                  />
                )}
              {departmentSchedule &&
                departmentId &&
                version?.status !== "published" && (
                  <button
                    className="workspace-add-shift"
                    type="button"
                    disabled={busy}
                    onClick={() => openShift(true)}
                  >
                    <Plus size={17} aria-hidden /> הוספת משמרת
                  </button>
                )}
              {managementDepartment && (
                <div className={managementStyles.department}>
                  <DepartmentSelect
                    departments={departments}
                    value={departmentId}
                    onChange={selectDepartment}
                    label="מחלקה"
                  />
                </div>
              )}
            </div>
            {demo && teamActive && (
              <div
                className={managementStyles.sections}
                role="group"
                aria-label="תצוגות צוות"
              >
                <button
                  aria-pressed={page === "employees"}
                  onClick={() => setPage("employees")}
                >
                  {canEdit ? "עובדים" : "זמינות והיעדרויות"}
                </button>
                <button
                  aria-pressed={page === "team-desk"}
                  onClick={() => setPage("team-desk")}
                >
                  {canEdit ? "תלושים ותזכורות" : "התלושים שלי"}
                </button>
              </div>
            )}
            {canEdit && settingsActive && (
              <div
                className={managementStyles.sections}
                role="group"
                aria-label="מדורי הגדרות"
              >
                {settingsPages.map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={page === key}
                    onClick={() => setPage(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
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
            <div
              className={`alert workspace-notice ${canUndo ? "workspace-undo" : ""}`}
            >
              <span role="status">{notice}</span>
              {canUndo && lastUndo && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if ("targets" in lastUndo) {
                          await post("/api/change", lastUndo);
                          setNotice("הפעולה האחרונה בוטלה");
                        } else {
                          await commitChanges(lastUndo.operations, false, lastUndo.scope);
                        }
                        setLastUndo(null);
                      })
                    }
                  >
                    ביטול הפעולה האחרונה
                  </button>
                  <button
                    type="button"
                    aria-label="סגירת הודעה"
                    onClick={() => setNotice("")}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </>
              )}
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
          {page === "team-desk" && demo && (
            <DemoTeamDesk
              key={demoEmployee || "manager"}
              employees={data.employees}
              employeeId={demoEmployee}
              canEdit={canEdit}
            />
          )}
          {page === "organization" && canEdit && (
            <OrganizationWeek
              demo={demo}
              data={data}
              departments={departments}
              week={week}
              view={boardView}
              onView={setBoardView}
              onWeek={setWeek}
              onDepartment={openDepartmentSchedule}
              onOpenShift={(shift) => openShift(shift)}
              onReviewPublication={() => openPublication()}
              onApplyPlan={async (targets) => {
                setError("");
                let results: WeeklyPlanResult[];
                try {
                  results = await post("/api/change", {
                    action: "apply_weekly_plan",
                    week,
                    targets: targets.map((target) => ({
                      department_id: target.departmentId,
                      version_id: target.versionId || null,
                      status: target.status,
                      revision: target.revision,
                      operations: target.operations,
                    })),
                  });
                } catch (cause) {
                  await load().catch(() => {});
                  throw cause;
                }
                setLastUndo({
                  action: "undo_weekly_plan",
                  week,
                  targets: results.map(({ changes, ...target }) => ({
                    ...target,
                    operations: reverseChanges(changes),
                    restore_published: targets.some((item) =>
                      item.departmentId === target.department_id && item.status === "published",
                    ),
                  })),
                });
                setNotice("השינויים נשמרו");
                await load().catch((cause: Error) => setError(cause.message));
              }}
            />
          )}
          {page === "schedule" && (
            <>
              {!canEdit && (
                <section className="workspace-next" aria-label="המשמרת הקרובה">
                  <CalendarDays size={19} aria-hidden />
                  <div>
                    <h2>המשמרת הקרובה</h2>
                    <p>
                      {nextPersonalShift ? (
                        <>
                          {shortDate(localDate(nextPersonalShift.starts_at))} ·{" "}
                          <bdi dir="ltr">
                            {time(nextPersonalShift.starts_at)}–
                            {time(nextPersonalShift.ends_at)}
                          </bdi>{" "}
                          ·{" "}
                          {name("departments", nextPersonalShift.department_id)}{" "}
                          · {name("sites", nextPersonalShift.site_id)}
                          {localDate(nextPersonalShift.ends_at) !==
                            localDate(nextPersonalShift.starts_at) &&
                            " · מסתיימת למחרת"}
                        </>
                      ) : (
                        "אין משמרת קרובה שפורסמה עבורך."
                      )}
                    </p>
                  </div>
                </section>
              )}
              <section
                className="planner-actions workspace-planner"
                aria-label={canEdit ? "ניהול הסידור" : "בחירת שבוע בסידור שלי"}
              >
                <div className="workspace-week">
                  <div
                    className="workspace-week-range"
                    role="group"
                    aria-label="ניווט בין שבועות"
                  >
                    <button
                      type="button"
                      aria-label="שבוע קודם"
                      onClick={() => setWeek(addDays(week, -7))}
                    >
                      <ChevronRight size={18} aria-hidden />
                    </button>
                    <strong aria-live="polite">
                      <bdi dir="ltr">{weekRange}</bdi>
                    </strong>
                    <button
                      type="button"
                      aria-label="שבוע הבא"
                      onClick={() => setWeek(addDays(week, 7))}
                    >
                      <ChevronLeft size={18} aria-hidden />
                    </button>
                  </div>
                  {week !== sunday() && (
                    <button type="button" className="workspace-this-week"
                      onClick={() => setWeek(sunday())}>השבוע</button>
                  )}
                </div>
                <div className="workspace-plan-controls">
                  <div className="workspace-plan-status">
                    <span
                      className={`workspace-status ${isPublished ? "published" : ""}`}
                    >
                      {isPublished
                        ? "פורסם"
                        : canEdit
                          ? version
                            ? "טיוטה"
                            : "טרם נוצר"
                          : "טרם פורסם"}
                    </span>
                    {canEdit && (
                      <span>
                        {assigned.length} משמרות
                        {openCount ? ` · ${openCount} פנויות` : ""}
                      </span>
                    )}
                  </div>
                  <div className="workspace-plan-buttons">
                    {canEdit && departmentId && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          (primaryAction === "review" &&
                            scheduleFocus === "conflicts")
                        }
                        onClick={runPrimaryAction}
                      >
                        {busy ? "מעדכן…" : primaryLabels[primaryAction]}
                      </button>
                    )}
                    <details
                      className="workspace-more"
                      key={`${departmentId}-${week}`}
                    >
                      <summary>עוד</summary>
                      <div className="workspace-more-content">
                        {canEdit && departmentId && (
                          <>
                            {!isPublished && (
                              <>
                                {primaryAction !== "publish" && version && (
                                  <div>
                                    <button
                                      disabled={busy || !!publishBlock}
                                      onClick={updatePublication}
                                    >
                                      פרסום סידור
                                    </button>
                                    {publishBlock && (
                                      <small>{publishBlock}</small>
                                    )}
                                  </div>
                                )}
                                {primaryAction !== "fill" &&
                                  assigned.length > 0 && (
                                    <div>
                                      <button
                                        disabled={busy || !!fillBlock}
                                        onClick={() => plan("fill")}
                                      >
                                        שיבוץ אוטומטי
                                      </button>
                                      {fillBlock && <small>{fillBlock}</small>}
                                    </div>
                                  )}
                                {!creationBlock &&
                                  !!scheduleOverview?.missing && (
                                    <>
                                      {primaryAction !== "generate" && (
                                        <button
                                          disabled={busy}
                                          onClick={() => plan("generate")}
                                        >
                                          השלמת משמרות
                                        </button>
                                      )}
                                      <button
                                        disabled={busy}
                                        onClick={() => plan("open")}
                                      >
                                        {assigned.length
                                          ? "השלמה ללא שיבוץ"
                                          : "יצירה ללא שיבוץ"}
                                      </button>
                                    </>
                                  )}
                                {!assigned.length && (
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void run(() =>
                                        commitChanges(
                                          copyPreviousWeek(
                                            data,
                                            week,
                                            departmentId,
                                          ),
                                        ),
                                      )
                                    }
                                  >
                                    העתקת השבוע הקודם
                                  </button>
                                )}
                                {assigned.some((a) => a.employee_id) && (
                                  <button
                                    disabled={busy}
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
                                )}
                                <label className="button">
                                  <Upload size={16} aria-hidden /> ייבוא
                                  <input
                                    type="file"
                                    hidden
                                    accept=".csv,.xlsx"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file)
                                        void run(async () => {
                                          if (file.size > 2_000_000)
                                            throw new Error(
                                              "גודל קובץ מרבי: 2MB",
                                            );
                                          const { parseWorkbook } =
                                            await import("@/lib/spreadsheet");
                                          const rows =
                                            await parseWorkbook(file);
                                          if (rows.length > 100)
                                            throw new Error(
                                              "עד 100 שורות בייבוא אחד",
                                            );
                                          setImportRows(rows);
                                          setMapping({});
                                        });
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </>
                            )}
                            {version && (
                              <button
                                disabled={busy}
                                onClick={() => setArchivePrompt(true)}
                              >
                                העברה לסל המחזור
                              </button>
                            )}
                            {archivedSchedules
                              .slice()
                              .reverse()
                              .map((v, index) => (
                                <div key={v.id}>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      version
                                        ? setRestorePrompt(v.id)
                                        : void run(() =>
                                            lifecycle("restore", v.id),
                                          )
                                    }
                                  >
                                    {archivedSchedules.length === 1
                                      ? "שחזור סידור"
                                      : `שחזור סידור ${index + 1}`}
                                  </button>
                                  <small>
                                    {
                                      data.shift_assignments.filter(
                                        (a) => a.version_id === v.id,
                                      ).length
                                    }{" "}
                                    משמרות בסל המחזור
                                  </small>
                                </div>
                              ))}
                          </>
                        )}
                        <button onClick={() => void run(exportExcel)}>
                          <Download size={16} aria-hidden /> ייצוא Excel
                        </button>
                        <button onClick={() => window.print()}>
                          <Printer size={16} aria-hidden /> הדפסה
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
                {canEdit && conflicts.length > 0 && (
                  <p role="alert" className="workspace-plan-warning">
                    {conflicts.length} שיבוצים דורשים בדיקה לפני פרסום.
                    {scheduleFocus === "conflicts" &&
                      " מוצגת רשימת השיבוצים לבדיקה."}
                  </p>
                )}
                {canEdit &&
                  (primaryAction === "configure" || gaps.length > 0) && (
                    <p className="workspace-plan-warning">
                      {primaryAction === "configure"
                        ? creationBlock
                        : `חסרים ${gaps.reduce((n, gap) => n + gap.missing, 0)} שיבוצים לפי דרישות האיוש`}
                    </p>
                  )}
              </section>
              <section className="panel schedule-panel">
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
                        onChange={(e) => {
                          setView(e.target.value);
                          setScheduleFocus("all");
                        }}
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
                {scheduleFocus !== "all" && (
                  <div className="schedule-focus" role="status">
                    <span>
                      {scheduleFocus === "open"
                        ? "מוצגות משמרות פנויות בלבד"
                        : "מוצגים שיבוצים שדורשים בדיקה"}{" "}
                      · {filtered.length}
                    </span>
                    <button onClick={() => setScheduleFocus("all")}>
                      הצגת כל המשמרות
                    </button>
                  </div>
                )}
                {!assigned.length && view === "week" ? (
                  <div className="workspace-empty">
                    {canEdit
                      ? archived
                        ? "הסידור הקודם נמצא בסל המחזור. אפשר לשחזר אותו בתפריט ״עוד״."
                        : "אין משמרות בסידור השבוע."
                      : "לא פורסמו עבורך משמרות בשבוע הזה."}
                  </div>
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
                            {filtered
                              .filter(
                                (shift) => localDate(shift.starts_at) === day,
                              )
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
                          {displayData.shift_assignments
                            .filter(
                              (a) =>
                                displayData.schedule_versions.some(
                                  (v) =>
                                    v.id === a.version_id &&
                                    (v.status === "published" ||
                                      (canEdit && v.status === "draft")),
                                ) &&
                                (canEdit ||
                                  a.employee_id === personalEmployeeId) &&
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
              </section>
            </>
          )}
          {page === "employees" && (
            <section className={`panel ${managementStyles.team}`}>
              <div className={managementStyles.sectionHeader}>
                <h2>
                  {canEdit ? "אנשי הצוות" : "הפרטים שלי"}
                  {canEdit && (
                    <span className="badge" role="status">
                      {activeEmployeeFilters
                        ? `${visibleEmployees.length} מתוך ${departmentEmployees.length}`
                        : departmentEmployees.length}
                    </span>
                  )}
                </h2>
                {isAdmin && (
                  <button
                    type="button"
                    className="primary"
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
              <div className={managementStyles.filters}>
                <div className={managementStyles.searchRow}>
                  <label className={managementStyles.search}>
                    <Search size={17} aria-hidden />
                    <input
                      type="search"
                      placeholder="חיפוש לפי שם"
                      aria-label="חיפוש עובד"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {activeEmployeeFilters && (
                    <button
                      type="button"
                      className={managementStyles.clear}
                      onClick={clearEmployeeFilters}
                    >
                      איפוס סינון
                    </button>
                  )}
                </div>
                <div className={managementStyles.filterFields}>
                  <label>
                    תפקיד
                    <select
                      aria-label="סינון תפקיד"
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                    >
                      <option value="">הכול</option>
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
                      <option value="">הכול</option>
                      {data.sites.map((r) => (
                        <option key={r.id} value={r.id}>
                          {String(r.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    היעדרויות
                    <select
                      aria-label="סינון היעדרויות"
                      value={absenceFilter}
                      onChange={(e) => setAbsenceFilter(e.target.value)}
                    >
                      <option value="">הכול</option>
                      <option value="absent">עם היעדרויות</option>
                      <option value="present">ללא היעדרויות מדווחות</option>
                    </select>
                  </label>
                </div>
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
                        {e.weekly_availability != null && (
                          <small className="employee-weekly-summary">
                            {weeklyAvailabilitySummary(e.weekly_availability)}
                          </small>
                        )}
                      </td>
                      <td>
                        {(employeeMemberships.get(e.id) || [])
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
                        {absentInWeek(e.id) && (
                          <span className="badge absence-badge">
                            היעדרות בשבוע הנבחר
                          </span>
                        )}
                      </td>
                      <td>
                        {!isAdmin && mayManageAbsence(e) && (
                          <div className="row">
                            <button onClick={() => openAvailability(e)}>
                              דיווח זמינות
                            </button>
                            <button onClick={() => openAbsence(e)}>
                              חופשות והיעדרויות
                            </button>
                          </div>
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
                            <button onClick={() => openAvailability(e)}>
                              דיווח זמינות
                            </button>
                            <button onClick={() => openAbsence(e)}>
                              חופשות והיעדרויות
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleEmployees.length && (
                <Empty
                  text={
                    activeEmployeeFilters
                      ? "לא נמצאו עובדים לפי הסינון שנבחר"
                      : "עדיין אין עובדים להצגה"
                  }
                />
              )}
              <section
                className="absence-list"
                aria-label="חופשות והיעדרויות מדווחות"
              >
                <div className="section-heading">
                  <div>
                    <h3>זמינות והיעדרויות בשבוע הנבחר</h3>
                    <p className="muted">
                      <bdi>
                        {absenceDate(week)} – {absenceDate(addDays(week, 6))}
                      </bdi>
                    </p>
                  </div>
                  <div className="row">
                    <button
                      aria-label="שבוע קודם בהיעדרויות"
                      onClick={() => setWeek(addDays(week, -7))}
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button onClick={() => setWeek(sunday())}>השבוע</button>
                    <button
                      aria-label="שבוע הבא בהיעדרויות"
                      onClick={() => setWeek(addDays(week, 7))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </div>
                {visibleAvailability.map((record) => {
                  const employee = visibleEmployeesById.get(
                    String(record.employee_id),
                  )!;
                  const start = String(record.starts_at);
                  const end = String(record.ends_at);
                  return (
                    <article className="absence-record" key={record.id}>
                      <div>
                        <strong>{String(employee.name)} · חלון זמינות</strong>
                        <p>
                          {shortDate(localDate(start))} {time(start)} –{" "}
                          {shortDate(localDate(end))} {time(end)}
                        </p>
                      </div>
                      {mayManageAbsence(employee) && (
                        <button
                          onClick={() => openAvailability(employee, record)}
                        >
                          עריכת זמינות
                        </button>
                      )}
                    </article>
                  );
                })}
                {visibleAbsences
                  .sort((a, b) =>
                    String(a.starts_at).localeCompare(String(b.starts_at)),
                  )
                  .map((a) => {
                    const employee = data.employees.find(
                      (e) => e.id === a.employee_id,
                    )!;
                    return (
                      <article className="absence-record" key={a.id}>
                        <div>
                          <strong>
                            {employee.name as string} · {absenceLabel(a)}
                          </strong>
                          <p>
                            <bdi>
                              {absenceDate(localDate(String(a.starts_at)))} –{" "}
                              {absenceDate(absenceEndDay(a))}
                            </bdi>{" "}
                            · כולל יום הסיום
                          </p>
                          {!isWholeDayAbsence(a) && (
                            <small>
                              דיווח קודם לפי שעות:{" "}
                              <bdi>
                                {time(String(a.starts_at))}–
                                {time(String(a.ends_at))}
                              </bdi>
                            </small>
                          )}
                        </div>
                        {mayManageAbsence(employee) && (
                          <div className="row">
                            {isWholeDayAbsence(a) && (
                              <button onClick={() => openAbsence(employee, a)}>
                                עריכת היעדרות
                              </button>
                            )}
                            <button
                              className="text-danger"
                              onClick={() =>
                                void run(async () => {
                                  await post("/api/admin", {
                                    kind: "cancel_absence",
                                    data: { id: a.id },
                                  });
                                  setNotice(
                                    "דיווח ההיעדרות בוטל. הזמינות הקבועה נשארה ללא שינוי.",
                                  );
                                })
                              }
                            >
                              ביטול דיווח
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                {!visibleAbsences.length && !visibleAvailability.length && (
                  <p className="muted">
                    אין דיווחי זמינות או היעדרות בשבוע הנבחר.
                  </p>
                )}
              </section>
            </section>
          )}
          {canEdit && page === "departments" && (
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
          {page === "notifications" && (
            <ScheduleNotifications
              data={data}
              onRead={(id) =>
                run(async () => {
                  await post("/api/admin", {
                    kind: "notification",
                    data: { id },
                  });
                })
              }
              onOpenSchedule={(department, targetWeek) => {
                openDepartmentSchedule(department, targetWeek);
              }}
            />
          )}
          {canEdit && page === "history" && (
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
          {canEdit && page === "settings" && (
            <ScheduleSettings
              key={departmentId}
              templates={data.shift_templates.filter(
                (item) => item.department_id === departmentId,
              )}
              requirements={data.coverage_requirements.filter(
                (item) => item.department_id === departmentId,
              )}
              sites={data.sites}
              roles={data.roles.filter(
                (item) => item.department_id === departmentId,
              )}
              days={days}
              onTemplate={openTemplate}
              onCoverage={openCoverage}
              onRestRules={isAdmin ? openRestRules : undefined}
              onPermissions={isAdmin ? openPermissions : undefined}
            />
          )}
          <footer>
            MyShift · ניהול משמרות עם תמונה מלאה <span>Asia/Jerusalem</span>
          </footer>
        </div>
      </main>
      {publication && (
        <PublicationReview
          data={data}
          rows={publication.rows}
          weekRange={publication.weekRange}
          error={publication.error}
          onReload={() => loadPublication(publication)}
          onClose={() => {
            publicationRequest.current++;
            setPublication(null);
          }}
          restoreFocus={() => {
            if (publicationTrigger.current?.isConnected) publicationTrigger.current.focus();
            else document.querySelector<HTMLElement>(".org-week button[aria-pressed=true], .workspace-back")?.focus();
          }}
          onPublish={async (rows) => {
            await post("/api/change", {
              action: "publish_weekly_schedule",
              week: publication.week,
              targets: rows.map(({ department_id, version_id, revision }) => ({
                department_id, version_id, revision,
              })),
            });
            setLastUndo(null);
            setNotice(rows.length === 1 ? "הסידור פורסם" : `הסידורים פורסמו ב־${rows.length} מחלקות`);
            await load().catch((cause: Error) => setError(cause.message));
          }}
        />
      )}
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
      {editor && canEdit && (
        <Modal
          title={
            editor.shift === true
              ? "הוספת משמרת"
              : editor.shift.id
                ? "עריכת משמרת"
                : "יצירת משמרת דומה"
          }
          close={() => {
            if (!editorBusy.current) setEditor(null);
          }}
          shiftDialog
          restoreFocus={() => {
            const target = editorTrigger.current?.isConnected
              ? editorTrigger.current
              : document.querySelector<HTMLElement>(
                  ".org-week button[aria-pressed=true], .workspace-back",
                );
            if (!target) return false;
            target.focus();
            return true;
          }}
        >
          <ShiftEditor
            key={editor.generation}
            data={data}
            departmentId={editor.scope.departmentId}
            shift={editor.shift}
            week={editor.scope.week}
            date={editor.date}
            onBusyChange={(saving) => {
              editorBusy.current = saving;
            }}
            onSave={async (operation) => {
              await commitChanges([operation], true, editor.scope);
              setEditor(null);
            }}
            onDelete={async () => {
              if (editor.shift === true || !editor.shift.id) return;
              await commitChanges(
                [{ kind: "delete", id: editor.shift.id }],
                true,
                editor.scope,
              );
              setEditor(null);
            }}
            onCopy={(shift) => {
              const day = localDate(shift.starts_at);
              const next =
                addDays(day, 1) > addDays(editor.scope.week, 6)
                  ? day
                  : addDays(day, 1);
              setEditor({
                ...editor,
                date: next,
                generation: editor.generation + 1,
                shift: {
                  ...shift,
                  id: "",
                  employee_id: null,
                },
              });
            }}
            onReload={async () => {
              const snapshot = await load();
              const currentVersion = snapshot?.schedule_versions.find(
                (v) =>
                  v.week_start === editor.scope.week &&
                  v.department_id === editor.scope.departmentId &&
                  v.status !== "archived",
              );
              if (!snapshot)
                throw new Error(
                  "לא ניתן לטעון את המשמרת. בדקו את החיבור ונסו שוב.",
                );
              if (currentVersion?.status === "published")
                throw new Error(
                  "הסידור כבר פורסם. אפשר לפתוח אותו לעריכה בסידור המחלקה.",
                );
              let shift = editor.shift;
              if (shift !== true && shift.id) {
                const id = shift.id;
                const refreshed = snapshot.shift_assignments.find(
                  (row) =>
                    row.id === id && row.version_id === currentVersion?.id,
                );
                if (!refreshed)
                  throw new Error(
                    "המשמרת כבר אינה בסידור הפעיל. סגרו את החלון כדי לחזור ללוח.",
                  );
                shift = refreshed;
              }
              setEditor({
                ...editor,
                shift,
                generation: editor.generation + 1,
                scope: {
                  ...editor.scope,
                  versionId: currentVersion?.id,
                  revision: Number(currentVersion?.revision || 0),
                },
              });
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(
                    ".workspace-shift-dialog [data-shift-initial-focus]",
                  )
                  ?.focus(),
              );
            }}
          />
        </Modal>
      )}
      {entity && (
        <Modal title={entity.title} close={() => setEntity(null)}>
          <EntityForm
            fields={entity.fields}
            initial={entity.initial}
            onSubmit={saveEntity}
            submitLabel={entity.kind === "absence" ? "שמירת היעדרות" : "שמירה"}
            note={
              entity.kind === "absence"
                ? "הדיווח חל על ימים מלאים, כולל תאריך הסיום. שיבוצים קיימים יישארו לבדיקה."
                : entity.kind === "availability"
                  ? "בשבוע שבו מדווחים זמינות, השיבוץ יתאפשר בחלונות הזמינות שדווחו."
                  : undefined
            }
            employeeForm={entity.kind === "employee"}
            initialAvailability={
              data.employees.find((e) => e.id === entity.initial?.id)
                ?.weekly_availability
            }
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
  return (
    <>
      {demoControls}
      {workspace}
    </>
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
