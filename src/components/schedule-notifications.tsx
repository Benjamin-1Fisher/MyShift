"use client";
import { useId, useState } from "react";
import { AlertTriangle, CalendarCheck, ChevronLeft } from "lucide-react";
import { addDays, type Data } from "@/lib/domain";
import { noticeTitle, scheduleNotices } from "@/lib/schedule-notifications";

const dateTime = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  dateStyle: "medium",
  timeStyle: "short",
});
const calendarDate = (day: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(day + "T12:00:00Z"));

export default function ScheduleNotifications({
  data,
  onRead,
  onOpenSchedule,
}: {
  data: Data;
  onRead: (id: string) => Promise<void>;
  onOpenSchedule: (department: string, week: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const detailId = useId();
  const notices = scheduleNotices(data.notifications);
  return (
    <section
      className="panel schedule-notifications"
      aria-label="התראות על סידורים"
    >
      <div className="section-heading">
        <div>
          <h2>עדכוני סידורים</h2>
          <p>פרסומים ושינויים בסידורים שפורסמו</p>
        </div>
      </div>
      {!notices.length && (
        <div className="empty">
          <CalendarCheck size={28} />
          <p>
            עדכונים יופיעו כאן כשסידור יפורסם או כשיהיה שינוי בסידור שפורסם.
          </p>
        </div>
      )}
      <div className="notice-list">
        {notices.map((notice) => {
          const warning = notice.kind !== "schedule_published";
          const open = expanded === notice.id;
          const department = data.departments.find(
            (d) => d.id === notice.department_id,
          );
          const targetId = `${detailId}-${notice.id}`;
          const title = noticeTitle(notice);
          return (
            <article
              key={notice.id}
              className={`schedule-notice ${warning ? "notice-warning" : "notice-publication"}`}
              aria-label={title}
            >
              <div className="notice-heading">
                <span className="notice-icon" aria-hidden="true">
                  {warning ? (
                    <AlertTriangle size={20} />
                  ) : (
                    <CalendarCheck size={20} />
                  )}
                </span>
                <div className="notice-content">
                  <div className="row">
                    <h3>{title}</h3>
                    <span className="notice-kind">
                      {warning ? "שינוי / חריגה" : "פרסום"}
                    </span>
                    {!notice.read && <span className="badge">חדש</span>}
                  </div>
                  <p>
                    {String(department?.name || "מחלקה")} · שבוע{" "}
                    <bdi>
                      {calendarDate(notice.week_start)} –{" "}
                      {calendarDate(addDays(notice.week_start, 6))}
                    </bdi>
                  </p>
                  <time dateTime={notice.created_at}>
                    {dateTime.format(new Date(notice.created_at))}
                  </time>
                </div>
                <button
                  type="button"
                  aria-label={`${open ? "סגירת פירוט" : "פירוט"}: ${title}`}
                  aria-expanded={open}
                  aria-controls={targetId}
                  onClick={() => {
                    setExpanded(open ? null : notice.id);
                    if (!open && !notice.read) void onRead(notice.id);
                  }}
                >
                  {open ? "סגירת פירוט" : "פירוט"}
                </button>
              </div>
              <div id={targetId} className="notice-details" hidden={!open}>
                {notice.kind === "schedule_withdrawn" ? (
                  <p>
                    {notice.details.reason === "archived"
                      ? "סידור זה הוסר מהסידורים הפעילים."
                      : "הסידור נמצא בעדכון. לאחר פרסום מחדש תוצג הגרסה המעודכנת."}
                  </p>
                ) : (
                  <p>
                    {notice.details.total_count} משמרות בסידור ·{" "}
                    {notice.details.open_count} פנויות לשיבוץ
                  </p>
                )}
                {notice.kind === "schedule_changed" && (
                  <p className="notice-change-summary">
                    נוספו {notice.details.added} משמרות · הוסרו{" "}
                    {notice.details.removed} · עודכנו {notice.details.updated}
                  </p>
                )}
                {department && department.active !== false && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenSchedule(notice.department_id, notice.week_start)
                    }
                  >
                    לסידור השבוע <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
