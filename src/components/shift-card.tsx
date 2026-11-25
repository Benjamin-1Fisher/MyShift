import type { CSSProperties, ReactNode } from "react";
import { Pencil, UserRoundPlus } from "lucide-react";
import { localDate, type Assignment } from "@/lib/domain";
import styles from "./shift-card.module.css";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const shiftClock = (value: string) => clock.format(new Date(value));

export default function ShiftCard({
  shift,
  employeeName,
  siteName,
  roleName,
  color,
  conflict,
  compact,
  onEdit,
}: {
  shift: Assignment;
  employeeName?: string;
  siteName: string;
  roleName?: string;
  color?: string;
  conflict?: boolean;
  compact?: boolean;
  onEdit?: () => void;
}) {
  const isOpen = !shift.employee_id;
  const name = isOpen ? "משמרת פנויה" : employeeName || "עובד משובץ";
  const start = shiftClock(shift.starts_at);
  const end = shiftClock(shift.ends_at);
  const overnight = localDate(shift.starts_at) !== localDate(shift.ends_at);
  const ActionIcon = isOpen ? UserRoundPlus : Pencil;
  const content: ReactNode = (
    <>
      <span className={styles.period}>
        <bdi className="shift-time" dir="ltr">
          {start}–{end}
        </bdi>
        {overnight && <span className={styles.overnight}>עד למחרת</span>}
      </span>
      <span className={styles.identity}>
        <strong>{name}</strong>
        <small>
          {siteName}
          {roleName && ` · ${roleName}`}
        </small>
        {conflict && <span className={styles.conflict}>שיבוץ לבדיקה</span>}
      </span>
      {onEdit && (
        <span className={styles.action}>
          <ActionIcon aria-hidden="true" size={13} />
          {isOpen ? "שיבוץ" : "עריכה"}
        </span>
      )}
    </>
  );
  const variant = compact ? "org-shift" : "shift";
  const className = [
    variant,
    styles.card,
    compact ? styles.compact : styles.standard,
    isOpen && (compact ? "org-shift-open" : "open"),
    isOpen && styles.open,
    conflict && styles.flagged,
  ]
    .filter(Boolean)
    .join(" ");
  const style = color
    ? ({ "--shift-accent": color } as CSSProperties)
    : undefined;
  const row = onEdit ? (
    <button
      type="button"
      className={`${styles.row} ${styles.interactive} ${compact ? "" : "shift-main"}`}
      aria-label={`${isOpen ? "שיבוץ" : "עריכה"} ${start} ${name}, ${siteName}`}
      onClick={onEdit}
    >
      {content}
    </button>
  ) : (
    <div className={styles.row}>{content}</div>
  );

  return compact ? (
    <li className={className} style={style}>
      {row}
    </li>
  ) : (
    <article className={className} style={style}>
      {row}
    </article>
  );
}
