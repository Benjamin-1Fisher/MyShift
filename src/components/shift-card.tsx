import { useId, type CSSProperties, type ReactNode } from "react";
import { Pencil, TriangleAlert, UserRoundPlus } from "lucide-react";
import { localDate, type Assignment } from "@/lib/domain";
import type { PublicationChangeKind } from "@/lib/weekly-schedule";
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
  conflictReason,
  publicationChange,
  compact,
  onEdit,
}: {
  shift: Assignment;
  employeeName?: string;
  siteName: string;
  roleName?: string;
  color?: string;
  conflict?: boolean;
  conflictReason?: string;
  publicationChange?: {
    kind: PublicationChangeKind;
    label: string;
    detail?: string;
  };
  compact?: boolean;
  onEdit?: () => void;
}) {
  const statusId = useId();
  const isOpen = !shift.employee_id;
  const hasIssue = Boolean(conflict || conflictReason);
  const hasStatus = hasIssue || Boolean(publicationChange);
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
        {hasStatus && (
          <span className={styles.statuses} id={statusId}>
            {hasIssue && (
              <span className={styles.issue}>
                <TriangleAlert size={12} aria-hidden />
                {conflictReason || "שיבוץ לבדיקה"}
              </span>
            )}
            {publicationChange && (
              <span
                className={styles.change}
                data-kind={publicationChange.kind}
              >
                <span>{publicationChange.label}</span>
                {publicationChange.detail && (
                  <span className={styles.changeDetail}>
                    {publicationChange.detail}
                  </span>
                )}
              </span>
            )}
          </span>
        )}
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
    hasIssue && styles.flagged,
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
      aria-describedby={hasStatus ? statusId : undefined}
      onClick={onEdit}
    >
      {content}
    </button>
  ) : (
    <div className={styles.row}>{content}</div>
  );

  return compact ? (
    <li
      className={className}
      style={style}
      data-publication-change={publicationChange?.kind}
    >
      {row}
    </li>
  ) : (
    <article
      className={className}
      style={style}
      data-publication-change={publicationChange?.kind}
    >
      {row}
    </article>
  );
}
