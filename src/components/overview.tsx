"use client";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";
import { addDays, localDate, sunday, type Data, type Row } from "@/lib/domain";
import {
  buildDepartmentOverview,
  employeeWeekShifts,
  type DepartmentOverview,
  type ScheduleFocus,
} from "@/lib/overview";

type Navigate = (
  department: string,
  target: "schedule" | "settings",
  focus?: ScheduleFocus,
) => void;
const date = (day: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "short",
  }).format(new Date(day + "T12:00:00Z"));
const clock = (value: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
function nextAction(row: DepartmentOverview): {
  label: string;
  target: "schedule" | "settings";
  focus: ScheduleFocus;
} {
  if (row.issue || (!row.configured && !row.total))
    return { label: "הגדרת שעות", target: "settings", focus: "all" };
  if (row.conflicts)
    return { label: "בדיקת חריגות", target: "schedule", focus: "conflicts" };
  if (row.missing || !row.total)
    return {
      label:
        row.status === "published"
          ? "בדיקת הסידור"
          : row.total
            ? "השלמת הסידור"
            : "יצירת סידור",
      target: "schedule",
      focus: "all",
    };
  if (row.open)
    return { label: "שיבוץ עובדים", target: "schedule", focus: "open" };
  if (row.shortage)
    return { label: "בדיקת איוש", target: "schedule", focus: "all" };
  return {
    label: row.status === "published" ? "צפייה בסידור" : "בדיקה ופרסום",
    target: "schedule",
    focus: "all",
  };
}
function Metric({
  value,
  label,
  onClick,
}: {
  value: number;
  label: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
      {onClick && <ChevronLeft size={16} aria-hidden="true" />}
    </>
  );
  return onClick ? (
    <button className="overview-metric" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="overview-metric">{content}</div>
  );
}

export default function Overview({
  data,
  departments,
  week,
  canEdit,
  employeeId,
  onWeekChange,
  onNavigate,
}: {
  data: Data;
  departments: Row[];
  week: string;
  canEdit: boolean;
  employeeId?: string;
  onWeekChange: (week: string) => void;
  onNavigate: Navigate;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (canEdit) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [canEdit]);
  const rows = canEdit ? buildDepartmentOverview(data, week, departments) : [];
  const ownShifts = canEdit
    ? []
    : employeeWeekShifts(data, week, employeeId, departments);
  const conflicts = rows.find((r) => r.conflicts),
    open = rows.find((r) => r.open);
  const awaiting =
    rows.find((r) => r.status === "draft" && r.total) ||
    rows.find((r) => r.status !== "published");
  const incomplete = rows.find((r) => r.total && r.missing);
  const priority =
    conflicts ||
    open ||
    incomplete ||
    rows.find((r) => r.shortage && r.total) ||
    awaiting ||
    rows.find((r) => r.issue || !r.total);
  const navigate = (row: DepartmentOverview, focus?: ScheduleFocus) => {
    const action = nextAction(row);
    onNavigate(row.department.id, action.target, focus || action.focus);
  };
  const nextShift = ownShifts.find((a) => Date.parse(a.ends_at) > now);
  return (
    <div className="overview" aria-label="מצב השבוע">
      <section className="panel overview-week" aria-label="בחירת שבוע בסקירה">
        <div>
          <h2>{canEdit ? "מצב סידורי השבוע" : "המשמרות שלי"}</h2>
          <p>
            {date(week)} – {date(addDays(week, 6))}
          </p>
        </div>
        <div className="row">
          <button
            aria-label="שבוע קודם"
            onClick={() => onWeekChange(addDays(week, -7))}
          >
            <ChevronRight size={18} />
          </button>
          <button onClick={() => onWeekChange(sunday())}>השבוע</button>
          <button
            aria-label="שבוע הבא"
            onClick={() => onWeekChange(addDays(week, 7))}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      </section>
      {canEdit ? (
        <>
          <div className="overview-metrics">
            <Metric
              label="משמרות פנויות"
              value={rows.reduce((sum, r) => sum + r.open, 0)}
              onClick={
                open
                  ? () => onNavigate(open.department.id, "schedule", "open")
                  : undefined
              }
            />
            <Metric
              label="סידורים שטרם פורסמו"
              value={rows.filter((r) => r.status !== "published").length}
              onClick={awaiting ? () => navigate(awaiting) : undefined}
            />
            <Metric
              label="שיבוצים לבדיקה"
              value={rows.reduce((sum, r) => sum + r.conflicts, 0)}
              onClick={
                conflicts
                  ? () =>
                      onNavigate(
                        conflicts.department.id,
                        "schedule",
                        "conflicts",
                      )
                  : undefined
              }
            />
          </div>
          {priority && (
            <section className="overview-next" aria-label="מה דורש טיפול">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <h2>
                  {conflicts
                    ? "יש שיבוצים שדורשים בדיקה"
                    : open
                      ? "נשארו משמרות פנויות"
                      : incomplete
                        ? "צריך להשלים את משמרות השבוע"
                        : priority.status === "draft" && priority.total
                          ? "סידור ממתין לבדיקה לפני פרסום"
                          : !priority.configured
                            ? "צריך להגדיר שעות לפני יצירת סידור"
                            : "עדיין אין סידור מוכן לשבוע הזה"}
                </h2>
                <p>
                  {String(priority.department.name)}
                  {conflicts
                    ? ` · ${priority.conflicts} שיבוצים לא מתאימים לזמינות, להכשרה או למנוחה`
                    : open
                      ? ` · ${priority.open} משמרות ממתינות לעובד`
                      : incomplete
                        ? ` · ${priority.missing} משמרות להשלמה לפי התבניות ודרישות האיוש`
                        : " · אפשר לעבור ישירות לשלב הבא"}
                </p>
              </div>
              <button
                onClick={() =>
                  open && !conflicts
                    ? onNavigate(priority.department.id, "schedule", "open")
                    : navigate(priority)
                }
              >
                {open && !conflicts
                  ? "למשמרות הפנויות"
                  : nextAction(priority).label}
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            </section>
          )}
          {!priority && rows.length > 0 && (
            <p className="overview-ready">
              <CalendarCheck size={20} aria-hidden="true" />
              הסידורים לשבוע הזה פורסמו, ללא משמרות פנויות או חריגות שזוהו.
            </p>
          )}
          <section
            className="panel overview-departments"
            aria-label="מצב סידור לפי מחלקה"
          >
            <h2>המחלקות שבאחריותך</h2>
            {!rows.length && (
              <p className="muted">עדיין אין מחלקות פעילות לניהול.</p>
            )}
            {rows.map((row) => (
              <article
                className="overview-department"
                key={row.department.id}
                aria-label={String(row.department.name)}
              >
                <div className="overview-department-title">
                  <span
                    className="department-indicator"
                    style={{
                      background: String(row.department.color || "#7360d6"),
                    }}
                    aria-hidden="true"
                  />
                  <h3>{String(row.department.name)}</h3>
                  <span
                    className={`badge ${row.status === "published" ? "overview-published" : ""}`}
                  >
                    {row.status === "published"
                      ? "פורסם"
                      : row.status === "missing"
                        ? "טרם נוצר"
                        : "טיוטה"}
                  </span>
                </div>
                <div className="overview-department-info">
                  {row.total ? (
                    <p>
                      {row.staffed} מתוך {row.total} משמרות משובצות
                    </p>
                  ) : (
                    <p>
                      {row.status === "published"
                        ? "פורסם ללא משמרות"
                        : row.configured
                          ? "עדיין אין משמרות לשבוע הזה"
                          : "יש להגדיר שעות משמרת למחלקה"}
                    </p>
                  )}
                  <div className="row overview-issues">
                    {row.open > 0 && <span>{row.open} פנויות לשיבוץ</span>}
                    {row.conflicts > 0 && (
                      <span>{row.conflicts} שיבוצים לבדיקה</span>
                    )}
                    {row.missing > 0 && row.total > 0 && (
                      <span>{row.missing} משמרות להשלמה</span>
                    )}
                    {row.shortage > row.open && row.total > 0 && (
                      <span>{row.shortage} חוסרים בדרישות האיוש</span>
                    )}
                  </div>
                  {row.issue && <p className="overview-issue">{row.issue}</p>}
                </div>
                <button onClick={() => navigate(row)}>
                  {nextAction(row).label}
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
              </article>
            ))}
          </section>
        </>
      ) : (
        <section
          className="panel overview-personal"
          aria-label="המשמרות שפורסמו עבורך"
        >
          <h2>משמרות שפורסמו עבורך</h2>
          {!ownShifts.length && (
            <div className="empty">
              <CalendarCheck size={28} />
              <p>לא פורסמו עבורך משמרות בשבוע הזה.</p>
            </div>
          )}
          {ownShifts.map((shift) => (
            <article className="overview-own-shift" key={shift.id}>
              <div>
                <strong>{date(localDate(shift.starts_at))}</strong>
                <p>
                  {String(
                    data.departments.find((d) => d.id === shift.department_id)
                      ?.name || "",
                  )}{" "}
                  ·{" "}
                  {String(
                    data.sites.find((s) => s.id === shift.site_id)?.name || "",
                  )}
                </p>
              </div>
              <span className="overview-shift-hours" dir="ltr">
                {clock(shift.starts_at)} – {clock(shift.ends_at)}
              </span>
              {localDate(shift.ends_at) !== localDate(shift.starts_at) && (
                <small>סיום למחרת</small>
              )}
              {nextShift?.id === shift.id && (
                <span className="badge">
                  <Clock size={13} aria-hidden="true" />
                  {Date.parse(shift.starts_at) <= now
                    ? "מתקיימת עכשיו"
                    : "המשמרת הבאה"}
                </span>
              )}
              <button
                onClick={() =>
                  onNavigate(shift.department_id, "schedule", "all")
                }
              >
                פתיחת הסידור
              </button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
