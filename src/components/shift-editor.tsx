"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  addDays,
  interval,
  localDate,
  type Assignment,
  type Data,
  type Operation,
} from "@/lib/domain";
import { canAssign } from "@/lib/planner";
import { shiftClock } from "./shift-card";
import styles from "./shift-editor.module.css";

const displayDate = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "short",
  day: "numeric",
  month: "numeric",
});
const weekdays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const templateTime = (value: unknown) => String(value || "").slice(0, 5);

export default function ShiftEditor({
  data,
  departmentId,
  shift,
  week,
  date,
  onSave,
  onDelete,
  onCopy,
  onBusyChange,
  onReload,
}: {
  data: Data;
  departmentId: string;
  shift: Assignment | true;
  week: string;
  date: string;
  onSave: (op: Operation) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopy: (shift: Assignment) => void;
  onBusyChange?: (busy: boolean) => void;
  onReload?: () => Promise<void>;
}) {
  const original = shift === true ? null : shift;
  const existing = !!original?.id;
  const copying = !!original && !existing;
  const department = original?.department_id || departmentId;
  const departmentName = data.departments.find(
    (row) => row.id === department,
  )?.name;
  const roles = data.roles.filter((row) => row.department_id === department);
  const templates = data.shift_templates.filter(
    (template) =>
      template.department_id === department &&
      template.confirmed &&
      template.start_time &&
      template.end_time,
  );
  const originalDay = original ? localDate(original.starts_at) : "";
  const originalStart = original ? shiftClock(original.starts_at) : "";
  const originalEnd = original ? shiftClock(original.ends_at) : "";
  const [site, setSite] = useState(
    original?.site_id || data.sites[0]?.id || "",
  );
  const [role, setRole] = useState(original?.role_id || roles[0]?.id || "");
  const [day, setDay] = useState(existing ? originalDay : date);
  const [start, setStart] = useState(
    originalStart || templateTime(templates[0]?.start_time),
  );
  const [end, setEnd] = useState(
    originalEnd || templateTime(templates[0]?.end_time),
  );
  const [customHours, setCustomHours] = useState(
    templates.length === 0 ||
      (!!original &&
        !templates.some(
          (template) =>
            templateTime(template.start_time) === originalStart &&
            templateTime(template.end_time) === originalEnd,
        )),
  );
  const [employee, setEmployee] = useState(original?.employee_id || "");
  const [detailsOpen, setDetailsOpen] = useState(!existing);
  const [pending, setPending] = useState<"save" | "delete" | "reload" | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const dayButton = useRef<HTMLButtonElement>(null);
  const busy = pending !== null;

  useEffect(() => {
    if (confirmDelete) cancelDelete.current?.focus();
  }, [confirmDelete]);
  useEffect(() => {
    if (copying) dayButton.current?.focus();
  }, [copying]);

  const lastDay = addDays(week, 6);
  let candidate: Assignment | null = null;
  let invalidTime = false;
  if (site && role && day >= week && day <= lastDay && start && end) {
    try {
      // Changing a worker must preserve the stored instant, including across a clock change.
      const times =
        original &&
        day === originalDay &&
        start === originalStart &&
        end === originalEnd
          ? { starts_at: original.starts_at, ends_at: original.ends_at }
          : interval(day, start, end);
      candidate = {
        id: original?.id || "",
        version_id: original?.version_id || "",
        department_id: department,
        site_id: site,
        role_id: role,
        employee_id: employee || null,
        ...times,
      };
    } catch {
      invalidTime = true;
    }
  }
  const candidates = data.employees
    .filter(
      (row) =>
        row.id === employee ||
        (row.active &&
          data.employee_departments.some(
            (membership) =>
              membership.employee_id === row.id &&
              membership.department_id === department &&
              membership.role_id === role,
          )),
    )
    .map((row) => ({
      row,
      eligible: !!candidate && canAssign(data, candidate, row.id),
    }));
  const workerUnavailable =
    !!candidate &&
    !!employee &&
    !candidates.some(({ row, eligible }) => row.id === employee && eligible);
  const stale =
    !!onReload && /השתנ|רעננ|לא נמצ|סגור לעריכה|במצב טיוטה/.test(error);

  async function perform(
    kind: NonNullable<typeof pending>,
    action: () => Promise<void>,
  ) {
    if (running.current) return;
    running.current = true;
    setPending(kind);
    onBusyChange?.(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setConfirmDelete(false);
      setError((failure as Error).message);
    } finally {
      running.current = false;
      setPending(null);
      onBusyChange?.(false);
    }
  }

  const shown = candidate || original;
  const shownSite = data.sites.find((row) => row.id === shown?.site_id)?.name;
  const shownRole = roles.find((row) => row.id === shown?.role_id)?.name;
  const showCustomHours = customHours || templates.length === 0;
  const showCustomRange =
    !showCustomHours &&
    start &&
    end &&
    !templates.some(
      (template) =>
        templateTime(template.start_time) === start &&
        templateTime(template.end_time) === end,
    );
  const originalWorker = original?.employee_id
    ? data.employees.find((row) => row.id === original.employee_id)?.name ||
      "עובד משובץ"
    : null;
  const replacement = originalWorker && employee !== original?.employee_id;
  const fixedDetails = existing
    ? []
    : [
        departmentName,
        data.sites.length === 1 && data.sites[0]?.name,
        roles.length === 1 && roles[0]?.name,
      ].filter(Boolean);

  return (
    <form
      className={styles.form}
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (workerUnavailable || stale || confirmDelete || running.current)
          return;
        if (!candidate) {
          setDetailsOpen(true);
          setError(
            invalidTime
              ? "השעה המקומית אינה קיימת. בחרו שעות אחרות."
              : "בחרו אתר, תפקיד, תאריך בשבוע הנבחר ושעות תקינות.",
          );
          return;
        }
        void perform("save", () =>
          onSave({
            ...candidate,
            kind: existing ? "update" : "create",
          }),
        );
      }}
    >
      {existing && shown && (
        <div className={styles.summary}>
          <CalendarDays aria-hidden="true" size={20} />
          <div>
            <div className={styles.summaryPeriod}>
              <strong>{displayDate.format(new Date(shown.starts_at))}</strong>
              <bdi dir="ltr">
                {shiftClock(shown.starts_at)}–{shiftClock(shown.ends_at)}
              </bdi>
              {localDate(shown.starts_at) !== localDate(shown.ends_at) && (
                <span>עד למחרת</span>
              )}
            </div>
            <span>
              {[departmentName, shownSite, shownRole]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      )}
      {copying && (
        <p className={styles.copyHint}>
          <Copy aria-hidden size={16} />
          השעות, האתר והתפקיד הועתקו. בחרו יום ושמרו כדי ליצור משמרת חדשה.
        </p>
      )}
      <div className={styles.worker}>
        {originalWorker && (
          <div className={styles.currentWorker}>
            <UserRound size={15} aria-hidden />
            <span>משובץ כרגע</span>
            <strong>{String(originalWorker)}</strong>
          </div>
        )}
        <label>
          {originalWorker ? "החלפת עובד" : "שיבוץ עובד"}
          <select
            data-shift-initial-focus={(existing && !!candidate) || undefined}
            disabled={!candidate || busy || stale || confirmDelete}
            value={employee}
            aria-invalid={workerUnavailable || undefined}
            aria-describedby={
              workerUnavailable ? "shift-worker-unavailable" : undefined
            }
            onChange={(event) => setEmployee(event.target.value)}
          >
            <option value="">השארת משמרת פנויה</option>
            {!!employee &&
              !candidates.some(({ row }) => row.id === employee) && (
                <option value={employee} disabled>
                  עובד משובץ לא זמין
                </option>
              )}
            {candidates.map(({ row, eligible }) => (
              <option key={row.id} value={row.id} disabled={!eligible}>
                {String(row.name)}
                {!eligible ? " · לא זמין לשיבוץ" : ""}
              </option>
            ))}
          </select>
        </label>
        {replacement && (
          <p className={styles.replacement} role="status">
            {String(originalWorker)} <span aria-hidden>←</span>
            <span className="sr-only">יוחלף בשיבוץ הבא</span>
            <strong>
              {employee
                ? String(
                    data.employees.find((row) => row.id === employee)?.name ||
                      "עובד נבחר",
                  )
                : "משמרת פנויה"}
            </strong>
          </p>
        )}
        {workerUnavailable ? (
          <p id="shift-worker-unavailable" className={styles.warning}>
            העובד הנוכחי לא זמין למשמרת. בחרו עובד זמין או השאירו אותה פנויה.
          </p>
        ) : (
          !candidate && (
            <p className={styles.hint}>מלאו את פרטי המשמרת כדי לבחור עובד.</p>
          )
        )}
      </div>

      <details
        className={styles.details}
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary
          data-shift-initial-focus={(existing && !candidate) || undefined}
        >
          פרטי משמרת <ChevronDown aria-hidden="true" size={16} />
        </summary>
        <fieldset
          disabled={busy || stale || confirmDelete}
          className={styles.fields}
        >
          <div className={styles.dayField} role="group" aria-label="יום בשבוע">
            <span>יום בשבוע</span>
            <div className={styles.dayChoices}>
              {weekdays.map((label, index) => {
                const value = addDays(week, index);
                const selected = day === value;
                return (
                  <button
                    key={value}
                    type="button"
                    ref={selected ? dayButton : undefined}
                    aria-label={displayDate.format(
                      new Date(value + "T12:00:00Z"),
                    )}
                    aria-pressed={selected}
                    data-shift-initial-focus={
                      (!existing && selected) || undefined
                    }
                    onClick={() => setDay(value)}
                  >
                    <strong>{label}</strong>
                    <small>
                      {value.slice(8)}.{value.slice(5, 7)}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.hours} role="group" aria-label="שעות המשמרת">
            <div className={styles.hoursHeading}>
              <span>
                {showCustomHours && templates.length > 0
                  ? "שעות מותאמות"
                  : "שעות המשמרת"}
                {showCustomRange && (
                  <bdi dir="ltr" className={styles.customRange}>
                    {start}–{end}
                  </bdi>
                )}
              </span>
              {templates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCustomHours((manual) => !manual)}
                >
                  {showCustomHours ? (
                    <>
                      <ChevronRight size={15} aria-hidden />
                      חזרה לתבניות
                    </>
                  ) : (
                    <>
                      <Clock3 size={15} aria-hidden />
                      שעות מותאמות
                    </>
                  )}
                </button>
              )}
            </div>
            <div className={styles.hourChoices} key={String(showCustomHours)}>
              {showCustomHours ? (
                <div className={styles.fieldRow}>
                  <label>
                    התחלה
                    <input
                      type="time"
                      required
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                    />
                  </label>
                  <label>
                    סיום
                    <input
                      type="time"
                      required
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className={styles.presets}>
                  {templates.map((template) => {
                    const from = templateTime(template.start_time);
                    const to = templateTime(template.end_time);
                    return (
                      <button
                        type="button"
                        key={template.id}
                        aria-pressed={start === from && end === to}
                        onClick={() => {
                          setStart(from);
                          setEnd(to);
                        }}
                      >
                        {String(template.name)}
                        <bdi dir="ltr">
                          {from}–{to}
                        </bdi>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {(data.sites.length !== 1 || roles.length !== 1) && (
            <div className={styles.fieldRow}>
              {data.sites.length !== 1 && (
                <label>
                  אתר
                  <select
                    value={site}
                    required
                    onChange={(event) => setSite(event.target.value)}
                  >
                    {!site && <option value="">בחירת אתר</option>}
                    {data.sites.map((row) => (
                      <option key={row.id} value={row.id}>
                        {String(row.name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {roles.length !== 1 && (
                <label>
                  תפקיד
                  <select
                    value={role}
                    required
                    onChange={(event) => {
                      setRole(event.target.value);
                      setEmployee("");
                    }}
                  >
                    {!role && <option value="">בחירת תפקיד</option>}
                    {roles.map((row) => (
                      <option key={row.id} value={row.id}>
                        {String(row.name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {fixedDetails.length > 0 && (
            <p className={styles.fixedDetails}>
              {[...new Set(fixedDetails)].join(" · ")}
            </p>
          )}
        </fieldset>
      </details>

      {error && (
        <div className={styles.error}>
          <p role="alert">{error}</p>
          {stale && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void perform("reload", onReload!)}
            >
              טעינת הפרטים העדכניים
            </button>
          )}
        </div>
      )}
      {confirmDelete ? (
        <div
          className={styles.confirmDelete}
          role="group"
          aria-label="אישור מחיקה"
        >
          <p>למחוק את המשמרת הזו מהסידור?</p>
          <button
            type="button"
            ref={cancelDelete}
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false);
              requestAnimationFrame(() => deleteButton.current?.focus());
            }}
          >
            ביטול
          </button>
          <button
            type="button"
            className="danger compact"
            disabled={busy || stale}
            onClick={() => void perform("delete", onDelete)}
          >
            {pending === "delete" ? "מוחק…" : "אישור מחיקה"}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="submit"
            className="primary"
            disabled={busy || workerUnavailable || stale}
          >
            {pending === "save" ? "שומר…" : "שמירה"}
          </button>
          {existing && original && (
            <>
              <button
                type="button"
                className={styles.copy}
                disabled={!candidate || busy || stale}
                onClick={() => candidate && onCopy(candidate)}
              >
                <Copy aria-hidden="true" size={16} />
                יצירת משמרת דומה
              </button>
              <button
                type="button"
                ref={deleteButton}
                className={styles.delete}
                disabled={busy || stale}
                aria-label="מחיקת משמרת"
                onClick={() => {
                  setError("");
                  setConfirmDelete(true);
                }}
              >
                <Trash2 aria-hidden="true" size={16} />
                מחיקה
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
