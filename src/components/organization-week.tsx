import { useId, useMemo } from "react";
import {
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Dot,
  Printer,
  Send,
} from "lucide-react";
import {
  addDays,
  localDate,
  sunday,
  type Assignment,
  type Data,
  type Row,
} from "@/lib/domain";
import { organizationWeek } from "@/lib/organization-week";
import { assignmentIssue } from "@/lib/planner";
import {
  publicationChangeKind,
  publicationChangeLabels,
  type PublicationReview,
  type ScheduleChange,
} from "@/lib/weekly-schedule";
import DepartmentSelect from "./department-select";
import ShiftCard, { shiftClock } from "./shift-card";
import WeeklyPlan, { type ApplyWeeklyPlan } from "./weekly-plan";
import styles from "./organization-week.module.css";

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const shortDays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const dateLabel = (date: string) =>
  date.split("-").slice(1).reverse().join(".");
const statuses: Record<string, string> = {
  draft: "טיוטה",
  published: "פורסם",
  "": "טרם נוצר סידור",
};
const filters = [
  {
    key: "open",
    label: "פנויות לשיבוץ",
    short: "פנויות",
    shown: "משמרות פנויות בלבד",
  },
  {
    key: "conflicts",
    label: "שיבוצים לבדיקה",
    short: "לבדיקה",
    shown: "משמרות עם בעיית שיבוץ בלבד",
  },
  {
    key: "unpublished",
    label: "ממתינים לפרסום",
    short: "טיוטות",
    shown: "טיוטות מחלקה בלבד",
  },
] as const;
type BoardFilter = "all" | (typeof filters)[number]["key"];
type BoardRow = ReturnType<typeof organizationWeek>["rows"][number];

export type BoardView = {
  day: string;
  filter: BoardFilter;
  departmentId: string;
};

export default function OrganizationWeek({
  data,
  departments,
  week,
  view,
  onView,
  onWeek,
  onDepartment,
  onOpenShift,
  onApplyPlan,
  onReviewPublication,
  publicationReviews,
  demo,
}: {
  data: Data;
  departments: Row[];
  week: string;
  view: BoardView;
  onView: (view: BoardView) => void;
  onWeek: (week: string) => void;
  onDepartment: (id: string) => void;
  onOpenShift: (shift: Assignment, isDraft: boolean) => void;
  onApplyPlan: ApplyWeeklyPlan;
  onReviewPublication: () => void;
  publicationReviews: PublicationReview[];
  demo: boolean;
}) {
  const board = useMemo(
    () => organizationWeek(data, departments, week),
    [data, departments, week],
  );
  const { dates } = board;
  const dayDescriptionId = useId();
  const draftCount = board.rows.filter((row) => row.status === "draft").length;
  const today = localDate(new Date().toISOString());
  const currentWeek = sunday();
  const day = dates.includes(view.day)
    ? view.day
    : dates.includes(today)
      ? today
      : week;
  const dayIndex = dates.indexOf(day);
  const activeDepartment = departments.some(
    ({ id }) => id === view.departmentId,
  )
    ? view.departmentId
    : "";
  const scopedRows = activeDepartment
    ? board.rows.filter(({ department }) => department.id === activeDepartment)
    : board.rows;

  const conflicts = useMemo(() => {
    const employeeShifts = new Map<string, Assignment[]>();
    for (const shift of data.shift_assignments) {
      if (!shift.employee_id) continue;
      const assigned = employeeShifts.get(shift.employee_id);
      if (assigned) assigned.push(shift);
      else employeeShifts.set(shift.employee_id, [shift]);
    }
    const conflicts = new Map<string, string>();
    for (const row of board.rows)
      for (const shifts of row.days)
        for (const shift of shifts) {
          if (!shift.employee_id) continue;
          const issue = assignmentIssue(
            data,
            shift,
            shift.employee_id,
            employeeShifts.get(shift.employee_id),
          );
          if (issue) conflicts.set(shift.id, issue);
        }
    return conflicts;
  }, [data, board.rows]);

  const names = useMemo(() => {
    const index = (rows: Row[]) =>
      new Map(rows.map((row) => [row.id, String(row.name)]));
    return {
      employees: index(data.employees),
      sites: index(data.sites),
      roles: index(data.roles),
    };
  }, [data.employees, data.sites, data.roles]);

  const changes = new Map<string, ScheduleChange>();
  const removals = new Map<string, Assignment[]>();
  for (const review of publicationReviews) {
    if (review.first_publication) continue;
    for (const change of review.changes) {
      const shift = change.after ?? change.before;
      if (!shift) continue;
      changes.set(shift.id, change);
      if (change.after) continue;
      const key = shift.department_id + ":" + localDate(shift.starts_at);
      const items = removals.get(key) ?? [];
      items.push(shift);
      removals.set(key, items);
    }
  }
  const removedOn = (row: BoardRow, index: number) =>
    view.filter === "all" || view.filter === "unpublished"
      ? (removals.get(row.department.id + ":" + dates[index]) ?? [])
      : [];
  const dayAttention = dates.map((_, index) => {
    const shifts = scopedRows.flatMap((row) => row.days[index]);
    return {
      issues: shifts.filter((shift) => conflicts.has(shift.id)).length,
      open: shifts.filter((shift) => !shift.employee_id).length,
    };
  });
  const attentionLabel = ({ issues, open }: (typeof dayAttention)[number]) =>
    [
      issues === 1
        ? "שיבוץ אחד לבדיקה"
        : issues
          ? `${issues} שיבוצים לבדיקה`
          : "",
      open === 1 ? "משמרת פנויה אחת" : open ? `${open} משמרות פנויות` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  function attentionMarker(index: number) {
    const { issues, open } = dayAttention[index];
    if (!issues && !open) return null;
    return (
      <span
        className={styles.dayMarker}
        data-issue={!!issues}
        title={attentionLabel(dayAttention[index])}
        aria-hidden="true"
      >
        {issues ? <CircleAlert size={11} /> : <Dot size={14} strokeWidth={5} />}
      </span>
    );
  }

  const shiftMatches = (shift: Assignment) =>
    view.filter === "open"
      ? !shift.employee_id
      : view.filter !== "conflicts" || conflicts.has(shift.id);
  const counts = { open: 0, conflicts: 0, unpublished: 0 };
  let total = 0;
  const rows: BoardRow[] = [];
  for (const row of scopedRows) {
    const shifts = row.days.flat();
    total += shifts.length;
    for (const shift of shifts) {
      if (!shift.employee_id) counts.open++;
      if (conflicts.has(shift.id)) counts.conflicts++;
    }
    const hasRemoval = dates.some((date) =>
      removals.has(row.department.id + ":" + date),
    );
    const unpublished =
      row.status === "draft" && (shifts.length > 0 || hasRemoval);
    if (unpublished) counts.unpublished++;
    if (view.filter === "unpublished" && !unpublished) continue;
    const filteredDays = row.days.map((shifts) => shifts.filter(shiftMatches));
    if (
      view.filter === "all" ||
      filteredDays.some((shifts) => shifts.length) ||
      (view.filter === "unpublished" && hasRemoval)
    )
      rows.push({ ...row, days: filteredDays });
  }
  const dailyRows =
    view.filter === "all"
      ? rows
      : rows.filter(
          (row) => row.days[dayIndex].length || removedOn(row, dayIndex).length,
        );
  const nearestDay = dates
    .filter((_, index) =>
      rows.some(
        (row) => row.days[index].length || removedOn(row, index).length,
      ),
    )
    .sort(
      (a, b) =>
        Math.abs(dates.indexOf(a) - dayIndex) -
        Math.abs(dates.indexOf(b) - dayIndex),
    )[0];
  const end = dates[6];
  const year = week.slice(0, 4);
  const startDate =
    dateLabel(week) + (year === end.slice(0, 4) ? "" : "." + year);
  const dateRange = (
    <bdi dir="ltr">
      <span>{startDate}</span>–<wbr />
      <span>
        {dateLabel(end)}.{end.slice(0, 4)}
      </span>
    </bdi>
  );

  function changeWeek(nextWeek: string) {
    onView({ ...view, day: "" });
    if (nextWeek !== week) onWeek(nextWeek);
  }

  function shiftList(
    row: BoardRow,
    shifts: Assignment[],
    index: number,
    printing = false,
  ) {
    const removed = printing ? [] : removedOn(row, index);
    if (!shifts.length && !removed.length)
      return (
        <span className="org-empty">
          {view.filter !== "all" && !printing ? "—" : "אין משמרות"}
        </span>
      );
    return (
      <ul className="org-shifts">
        {shifts.concat(removed).map((shift) => {
          const change = printing ? undefined : changes.get(shift.id);
          const kind = change ? publicationChangeKind(change) : undefined;
          const before = change?.before;
          const after = change?.after;
          const priorWorker =
            before?.employee_id &&
            after &&
            before.employee_id !== after.employee_id
              ? names.employees.get(before.employee_id) || "עובד משובץ"
              : undefined;
          const priorSchedule =
            before &&
            after &&
            (Date.parse(before.starts_at) !== Date.parse(after.starts_at) ||
              Date.parse(before.ends_at) !== Date.parse(after.ends_at) ||
              before.role_id !== after.role_id ||
              before.site_id !== after.site_id)
              ? [
                  dateLabel(localDate(before.starts_at)),
                  `${shiftClock(before.starts_at)}–${shiftClock(before.ends_at)}`,
                  names.sites.get(before.site_id),
                  names.roles.get(before.role_id),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined;
          const detail = [priorWorker, priorSchedule]
            .filter(Boolean)
            .join(" · ");
          return (
            <ShiftCard
              compact
              key={shift.id}
              shift={shift}
              employeeName={
                shift.employee_id
                  ? names.employees.get(shift.employee_id) || "עובד משובץ"
                  : undefined
              }
              siteName={names.sites.get(shift.site_id) || "אתר לא ידוע"}
              roleName={names.roles.get(shift.role_id) || "תפקיד לא ידוע"}
              color={String(row.department.color || "#7360d6")}
              conflict={conflicts.has(shift.id)}
              conflictReason={!printing ? conflicts.get(shift.id) : undefined}
              publicationChange={
                kind
                  ? {
                      kind,
                      label: publicationChangeLabels[kind],
                      detail: detail
                        ? `בפרסום הנוכחי: ${detail}`
                        : kind === "removed"
                          ? "מופיעה עדיין בפרסום הנוכחי"
                          : "ממתין לפרסום",
                    }
                  : undefined
              }
              onEdit={
                !printing && row.status === "draft" && kind !== "removed"
                  ? () => onOpenShift(shift, true)
                  : undefined
              }
            />
          );
        })}
      </ul>
    );
  }

  function departmentButton(department: Row) {
    const name = String(department.name);
    return (
      <button
        type="button"
        className="org-department-button"
        onClick={() => onDepartment(department.id)}
        aria-label={`לסידור המחלקה · ${name}`}
      >
        <span>{name}</span>
        <span className={styles.departmentAction}>
          לסידור המחלקה <ChevronLeft aria-hidden size={14} />
        </span>
      </button>
    );
  }

  function statusBadge(status: string) {
    return (
      <small className={styles.status} data-status={status}>
        {statuses[status]}
      </small>
    );
  }

  function matrix(printing = false) {
    return (
      <table className="org-matrix">
        <thead>
          <tr>
            <th scope="col">מחלקה</th>
            {dates.map((date, index) => (
              <th
                scope="col"
                key={date}
                data-today={date === today}
                aria-describedby={
                  !printing && attentionLabel(dayAttention[index])
                    ? `${dayDescriptionId}-table-${index}`
                    : undefined
                }
              >
                <strong>{weekdays[index]}</strong>
                <small>{dateLabel(date)}</small>
                {!printing && attentionMarker(index)}
                {!printing && attentionLabel(dayAttention[index]) && (
                  <span
                    className="sr-only"
                    id={`${dayDescriptionId}-table-${index}`}
                  >
                    {attentionLabel(dayAttention[index])}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(printing ? board.rows : rows).map((row) => (
            <tr key={row.department.id}>
              <th scope="row">
                {printing ? (
                  <strong>{String(row.department.name)}</strong>
                ) : (
                  departmentButton(row.department)
                )}
                {statusBadge(row.status)}
              </th>
              {row.days.map((shifts, index) => (
                <td key={dates[index]}>
                  {row.status ? (
                    shiftList(row, shifts, index, printing)
                  ) : (
                    <span className="org-empty">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section
      className={`org-week ${styles.board}`}
      aria-label="לוח שבועי לכל המחלקות"
    >
      <header className={styles.controls}>
        <div className={styles.weekLine}>
          <div
            className={styles.weekControls}
            role="group"
            aria-label="בחירת שבוע"
          >
            <button
              type="button"
              aria-label="השבוע הקודם"
              onClick={() => changeWeek(addDays(week, -7))}
            >
              <ChevronRight aria-hidden size={18} />
            </button>
            <strong className={styles.period}>{dateRange}</strong>
            <button
              type="button"
              aria-label="השבוע הבא"
              onClick={() => changeWeek(addDays(week, 7))}
            >
              <ChevronLeft aria-hidden size={18} />
            </button>
          </div>
          <div className={styles.weekActions}>
            {week !== currentWeek && (
              <button
                type="button"
                className={styles.currentWeek}
                onClick={() => changeWeek(currentWeek)}
              >
                השבוע
              </button>
            )}
            {board.rows.length > 0 && (
              <button
                type="button"
                className={styles.print}
                aria-label="הדפסה / PDF"
                title="הדפסה / PDF"
                onClick={() => window.print()}
              >
                <Printer aria-hidden size={17} />
                <span>הדפסה</span>
              </button>
            )}
          </div>
        </div>
        {board.rows.length > 0 && (
          <>
            <div className={styles.rosterActions}>
              <div className={styles.departmentFilter}>
                <DepartmentSelect
                  departments={departments}
                  value={activeDepartment}
                  allowAll
                  label="סינון לפי מחלקה"
                  onChange={(departmentId) => onView({ ...view, departmentId })}
                />
              </div>
              <WeeklyPlan
                data={data}
                departments={departments}
                week={week}
                dateRange={dateRange}
                names={names}
                onApply={onApplyPlan}
              />
            </div>
            <div
              className={styles.filters}
              role="group"
              aria-label="סינון משמרות שבועי"
            >
              <span className={styles.filterTitle}>הצגה</span>
              <button
                type="button"
                aria-pressed={view.filter === "all"}
                onClick={() => onView({ ...view, filter: "all" })}
              >
                הכול
              </button>
              {filters.map(({ key, label, short }) => (
                <button
                  type="button"
                  key={key}
                  data-filter={key}
                  aria-pressed={view.filter === key}
                  aria-label={`${counts[key]} ${label}`}
                  title={
                    key === "unpublished" ? "מחלקות עם טיוטה לפרסום" : label
                  }
                  disabled={!counts[key] && view.filter !== key}
                  onClick={() =>
                    onView({
                      ...view,
                      filter: view.filter === key ? "all" : key,
                    })
                  }
                >
                  <strong>{counts[key]}</strong>
                  <span className={styles.filterLabel}>{label}</span>
                  <span className={styles.shortFilterLabel} aria-hidden>
                    {short}
                  </span>
                </button>
              ))}
            </div>
            {view.filter !== "all" && (
              <p className={styles.filterStatus} role="status">
                מוצגות {filters.find(({ key }) => key === view.filter)?.shown}
                {" · "}
                {counts[view.filter]}{" "}
                {view.filter === "unpublished" ? "מחלקות" : "בכל השבוע"}
              </p>
            )}
            {draftCount > 0 && (
              <button
                type="button"
                className={styles.publication}
                onClick={onReviewPublication}
              >
                <Send size={16} aria-hidden />
                סקירה ופרסום
                <span>{draftCount} טיוטות</span>
              </button>
            )}
          </>
        )}
      </header>
      {board.rows.length > 0 && (
        <div className="org-print-sheet" aria-label="סידור שבועי להדפסה">
          <div className="org-print-heading">
            <h1>מיי שיפט · סידור שבועי</h1>
            <p>
              {dateRange} · {board.rows.length} מחלקות · {board.total} משמרות ·{" "}
              {board.unassigned} פנויות לשיבוץ
            </p>
            {demo && <p className="org-print-demo">נתוני דוגמה בלבד</p>}
          </div>
          {matrix(true)}
        </div>
      )}
      {!board.rows.length ? (
        <p className="org-no-departments">אין מחלקות זמינות להצגה.</p>
      ) : (
        <>
          <div
            className="org-desktop"
            role="region"
            aria-label="טבלת סידור שבועית"
            tabIndex={0}
          >
            {rows.length ? (
              matrix()
            ) : (
              <p className={styles.empty}>אין תוצאות לשבוע במסנן הזה.</p>
            )}
          </div>
          <div className="org-mobile">
            <div className="org-day-picker" role="group" aria-label="בחירת יום">
              {dates.map((date, index) => (
                <button
                  type="button"
                  key={date}
                  aria-pressed={day === date}
                  aria-label={weekdays[index] + " " + dateLabel(date)}
                  aria-describedby={
                    attentionLabel(dayAttention[index])
                      ? `${dayDescriptionId}-day-${index}`
                      : undefined
                  }
                  onClick={() => onView({ ...view, day: date })}
                >
                  {shortDays[index]}
                  <small>{dateLabel(date)}</small>
                  {attentionMarker(index)}
                  {attentionLabel(dayAttention[index]) && (
                    <span
                      className="sr-only"
                      id={`${dayDescriptionId}-day-${index}`}
                    >
                      {attentionLabel(dayAttention[index])}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className={styles.dailySchedule} key={day}>
              <div className={styles.dayHeading}>
                <h2>
                  {weekdays[dayIndex]} · {dateLabel(day)}
                </h2>
                <span>
                  {dailyRows.reduce(
                    (sum, row) => sum + row.days[dayIndex].length,
                    0,
                  )}{" "}
                  משמרות ביום
                </span>
              </div>
              {attentionLabel(dayAttention[dayIndex]) && (
                <p className={styles.dayAttention}>
                  {attentionLabel(dayAttention[dayIndex])}
                </p>
              )}
              {dailyRows.map((row) => (
                <section
                  className="org-mobile-department"
                  key={row.department.id}
                >
                  <header>
                    {departmentButton(row.department)}
                    {statusBadge(row.status)}
                  </header>
                  {row.status && shiftList(row, row.days[dayIndex], dayIndex)}
                </section>
              ))}
              {!dailyRows.length && (
                <div className={styles.empty}>
                  <p>אין תוצאות ביום הזה.</p>
                  {nearestDay && nearestDay !== day && (
                    <button
                      type="button"
                      onClick={() => onView({ ...view, day: nearestDay })}
                    >
                      מעבר ליום {weekdays[dates.indexOf(nearestDay)]} ·{" "}
                      {dateLabel(nearestDay)}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className={styles.weekTotal} aria-live="polite">
            {scopedRows.length} מחלקות · {total} משמרות בשבוע
          </p>
        </>
      )}
    </section>
  );
}
