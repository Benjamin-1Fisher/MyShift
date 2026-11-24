import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
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

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const mobileWeekdays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateLabel = (date: string) =>
  date.split("-").slice(1).reverse().join(".");
const statusLabel: Record<string, string> = {
  draft: "טיוטה",
  published: "פורסם",
  "": "טרם נוצר סידור",
};

export default function OrganizationWeek({
  data,
  departments,
  week,
  onWeek,
  onDepartment,
  onOpenShift,
}: {
  data: Data;
  departments: Row[];
  week: string;
  onWeek: (week: string) => void;
  onDepartment: (id: string) => void;
  onOpenShift: (shift: Assignment, isDraft: boolean) => void;
}) {
  const board = useMemo(
    () => organizationWeek(data, departments, week),
    [data, departments, week],
  );
  const [mobileDay, setMobileDay] = useState(() => {
    const today = localDate(new Date().toISOString());
    return Math.max(0, board.dates.indexOf(today));
  });
  const [gapsOnly, setGapsOnly] = useState(false);
  const openShifts = board.rows
    .flatMap((row) =>
      row.days
        .flatMap((day) => day.filter((shift) => !shift.employee_id))
        .map((shift) => ({
          shift,
          department: row.department,
          isDraft: row.status === "draft",
        })),
    )
    .sort(
      (a, b) => Date.parse(a.shift.starts_at) - Date.parse(b.shift.starts_at),
    );
  const needsSchedule = board.rows.filter((row) => !row.status).length;
  const [referenceTime] = useState(() => Date.now());
  const nextOpen =
    openShifts.find(({ shift }) => Date.parse(shift.ends_at) > referenceTime) ??
    openShifts[0];
  const names = useMemo(() => {
    const index = (rows: Row[]) =>
      new Map(rows.map((r) => [r.id, String(r.name)]));
    return {
      employees: index(data.employees),
      sites: index(data.sites),
      roles: index(data.roles),
    };
  }, [data.employees, data.sites, data.roles]);

  function shiftsFor(shifts: Assignment[]) {
    const visible = gapsOnly
      ? shifts.filter((shift) => !shift.employee_id)
      : shifts;
    if (!visible.length)
      return (
        <span className="org-empty">
          {gapsOnly ? "אין פתוחות" : "ללא משמרות"}
        </span>
      );
    return (
      <ul className="org-shifts">
        {visible.map((shift) => (
          <li
            className={
              shift.employee_id ? "org-shift" : "org-shift org-shift-open"
            }
            key={shift.id}
          >
            <strong>
              {shift.employee_id
                ? names.employees.get(shift.employee_id) || "עובד משובץ"
                : "פתוחה לשיבוץ"}
            </strong>
            <span>
              {names.sites.get(shift.site_id) || "אתר לא ידוע"} ·{" "}
              {names.roles.get(shift.role_id) || "תפקיד לא ידוע"}
            </span>
            <bdi dir="ltr">
              {clock.format(new Date(shift.starts_at))}–
              {clock.format(new Date(shift.ends_at))}
              {localDate(shift.starts_at) !== localDate(shift.ends_at) && (
                <abbr title="עד למחרת"> +1</abbr>
              )}
            </bdi>
          </li>
        ))}
      </ul>
    );
  }

  const departmentButton = (department: Row) => (
    <button
      type="button"
      className="org-department-button"
      onClick={() => onDepartment(department.id)}
    >
      {String(department.name)} <ChevronLeft aria-hidden size={14} />
    </button>
  );

  const end = board.dates[6];
  const year = week.slice(0, 4);
  const startDate =
    dateLabel(week) + (year === end.slice(0, 4) ? "" : "." + year);

  return (
    <section className="org-week" aria-label="לוח שבועי לכל המחלקות">
      <header className="org-controls">
        <div className="org-period">
          <CalendarDays aria-hidden size={22} />
          <div>
            <small>שבוע עבודה</small>
            <strong>
              <bdi dir="ltr">
                {startDate}–{dateLabel(end)}.{end.slice(0, 4)}
              </bdi>
            </strong>
          </div>
        </div>
        <div className="org-nav">
          <button
            type="button"
            aria-label="השבוע הקודם"
            onClick={() => onWeek(addDays(week, -7))}
          >
            <ChevronRight aria-hidden size={18} />
          </button>
          <button type="button" onClick={() => onWeek(sunday())}>
            השבוע הנוכחי
          </button>
          <button
            type="button"
            aria-label="השבוע הבא"
            onClick={() => onWeek(addDays(week, 7))}
          >
            <ChevronLeft aria-hidden size={18} />
          </button>
        </div>
        <div className="org-metrics" aria-live="polite">
          <span>
            <strong>{board.rows.length}</strong> מחלקות
          </span>
          <span>
            <strong>{board.total}</strong> משמרות
          </span>
          <button
            type="button"
            className="org-gaps"
            aria-pressed={gapsOnly}
            onClick={() => setGapsOnly(!gapsOnly)}
          >
            <strong>{board.unassigned}</strong> פתוחות לשיבוץ
          </button>
        </div>
      </header>
      {board.rows.length > 0 && (nextOpen || needsSchedule > 0) && (
        <aside className="org-priority" aria-label="דורש טיפול השבוע">
          <div className="org-priority-description">
            <CircleAlert aria-hidden size={19} />
            <div>
              <strong>דורש טיפול השבוע</strong>
              {nextOpen && (
                <p>
                  {String(nextOpen.department.name)} ·{" "}
                  {names.sites.get(nextOpen.shift.site_id) || "אתר לא ידוע"} ·{" "}
                  {
                    weekdays[
                      board.dates.indexOf(localDate(nextOpen.shift.starts_at))
                    ]
                  }{" "}
                  {dateLabel(localDate(nextOpen.shift.starts_at))} ·{" "}
                  <bdi dir="ltr">
                    {clock.format(new Date(nextOpen.shift.starts_at))}–
                    {clock.format(new Date(nextOpen.shift.ends_at))}
                  </bdi>
                </p>
              )}
              {needsSchedule > 0 && (
                <small>מחלקות בלי סידור לשבוע הזה: {needsSchedule}</small>
              )}
            </div>
          </div>
          {nextOpen && (
            <button
              type="button"
              onClick={() => onOpenShift(nextOpen.shift, nextOpen.isDraft)}
            >
              {nextOpen.isDraft ? "שבץ עובד" : "פתח את השיבוץ"}{" "}
              <ChevronLeft aria-hidden size={15} />
            </button>
          )}
        </aside>
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
            <table className="org-matrix">
              <thead>
                <tr>
                  <th scope="col">מחלקה</th>
                  {board.dates.map((date, i) => (
                    <th scope="col" key={date}>
                      <strong>{weekdays[i]}</strong>
                      <small>{dateLabel(date)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.department.id}>
                    <th scope="row">
                      {departmentButton(row.department)}
                      <small>{statusLabel[row.status]}</small>
                    </th>
                    {row.days.map((shifts, i) => (
                      <td key={board.dates[i]}>
                        {row.status ? (
                          shiftsFor(shifts)
                        ) : (
                          <span className="org-empty">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="org-mobile">
            <div className="org-day-picker" role="group" aria-label="בחירת יום">
              {board.dates.map((date, i) => (
                <button
                  type="button"
                  key={date}
                  aria-pressed={mobileDay === i}
                  aria-label={weekdays[i] + " " + dateLabel(date)}
                  onClick={() => setMobileDay(i)}
                >
                  {mobileWeekdays[i]}׳<small>{dateLabel(date)}</small>
                </button>
              ))}
            </div>
            <h2>
              {weekdays[mobileDay]} · {dateLabel(board.dates[mobileDay])}
            </h2>
            {board.rows.map((row) => (
              <section
                className="org-mobile-department"
                key={row.department.id}
              >
                <header>
                  {departmentButton(row.department)}
                  <small>{statusLabel[row.status]}</small>
                </header>
                {row.status && shiftsFor(row.days[mobileDay])}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
