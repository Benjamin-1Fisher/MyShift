import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, Printer } from "lucide-react";
import {
  addDays,
  localDate,
  sunday,
  type Assignment,
  type Data,
  type Row,
} from "@/lib/domain";
import { organizationWeek } from "@/lib/organization-week";
import { canAssign } from "@/lib/planner";
import DepartmentSelect from "./department-select";
import ShiftCard from "./shift-card";
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
  { key: "open", label: "פנויות לשיבוץ" },
  { key: "conflicts", label: "שיבוצים לבדיקה" },
  { key: "unpublished", label: "ממתינים לפרסום" },
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
  demo: boolean;
}) {
  const board = useMemo(
    () => organizationWeek(data, departments, week),
    [data, departments, week],
  );
  const { dates } = board;
  const today = localDate(new Date().toISOString());
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
    const conflicts = new Set<string>();
    for (const row of board.rows)
      for (const shifts of row.days)
        for (const shift of shifts)
          if (
            shift.employee_id &&
            !canAssign(
              data,
              shift,
              shift.employee_id,
              employeeShifts.get(shift.employee_id),
            )
          )
            conflicts.add(shift.id);
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
    const unpublished = row.status === "draft" && shifts.length > 0;
    if (unpublished) counts.unpublished++;
    if (view.filter === "unpublished" && !unpublished) continue;
    const filteredDays = row.days.map((shifts) => shifts.filter(shiftMatches));
    if (view.filter === "all" || filteredDays.some((shifts) => shifts.length))
      rows.push({ ...row, days: filteredDays });
  }
  const dailyRows =
    view.filter === "all"
      ? rows
      : rows.filter((row) => row.days[dayIndex].length);
  const nearestDay = dates
    .filter((_, index) => rows.some((row) => row.days[index].length))
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
      {startDate}–{dateLabel(end)}.{end.slice(0, 4)}
    </bdi>
  );

  function changeWeek(nextWeek: string) {
    onView({ ...view, day: "" });
    if (nextWeek !== week) onWeek(nextWeek);
  }

  function shiftList(row: BoardRow, shifts: Assignment[], printing = false) {
    if (!shifts.length)
      return (
        <span className="org-empty">
          {view.filter !== "all" && !printing ? "—" : "אין משמרות"}
        </span>
      );
    return (
      <ul className="org-shifts">
        {shifts.map((shift) => (
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
            onEdit={
              !printing && row.status === "draft"
                ? () => onOpenShift(shift, true)
                : undefined
            }
          />
        ))}
      </ul>
    );
  }

  function departmentButton(department: Row) {
    return (
      <button
        type="button"
        className="org-department-button"
        onClick={() => onDepartment(department.id)}
        title="פתיחת סידור המחלקה"
      >
        {String(department.name)} <ChevronLeft aria-hidden size={15} />
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
              <th scope="col" key={date} data-today={date === today}>
                <strong>{weekdays[index]}</strong>
                <small>{dateLabel(date)}</small>
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
                    shiftList(row, shifts, printing)
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
            <button
              type="button"
              className={styles.currentWeek}
              onClick={() => changeWeek(sunday())}
            >
              השבוע
            </button>
          </div>
          {board.rows.length > 0 && (
            <details className={styles.tools}>
              <summary>
                <Ellipsis size={19} aria-hidden /> עוד
              </summary>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  window.print();
                }}
              >
                <Printer aria-hidden size={17} /> הדפסה / PDF
              </button>
            </details>
          )}
        </div>
        {board.rows.length > 0 && (
          <div className={styles.filterLine}>
            <div
              className={styles.filters}
              role="group"
              aria-label="סינון משמרות שבועי"
            >
              {filters.map(({ key, label }) => (
                <button
                  type="button"
                  key={key}
                  data-filter={key}
                  aria-pressed={view.filter === key}
                  onClick={() =>
                    onView({
                      ...view,
                      filter: view.filter === key ? "all" : key,
                    })
                  }
                >
                  <strong>{counts[key]}</strong> {label}
                </button>
              ))}
            </div>
            <div className={styles.departmentFilter}>
              <DepartmentSelect
                departments={departments}
                value={activeDepartment}
                allowAll
                label="סינון לפי מחלקה"
                onChange={(departmentId) => onView({ ...view, departmentId })}
              />
            </div>
          </div>
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
                  onClick={() => onView({ ...view, day: date })}
                >
                  {shortDays[index]}
                  <small>{dateLabel(date)}</small>
                </button>
              ))}
            </div>
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
            {dailyRows.map((row) => (
              <section
                className="org-mobile-department"
                key={row.department.id}
              >
                <header>
                  {departmentButton(row.department)}
                  {statusBadge(row.status)}
                </header>
                {row.status && shiftList(row, row.days[dayIndex])}
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
          <p className={styles.weekTotal} aria-live="polite">
            {scopedRows.length} מחלקות · {total} משמרות בשבוע
          </p>
        </>
      )}
    </section>
  );
}
