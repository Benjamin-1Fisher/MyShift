"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Data } from "@/lib/domain";
import {
  publicationChangeKind,
  publicationChangeLabels,
  type PublicationReview as Review,
  type ScheduleChange,
} from "@/lib/weekly-schedule";
import { shiftClock } from "./shift-card";
import styles from "./publication-review.module.css";

const date = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "short",
  day: "numeric",
  month: "numeric",
});

export default function PublicationReview({
  data,
  rows,
  weekRange,
  error,
  onReload,
  onPublish,
  onClose,
  restoreFocus,
}: {
  data: Data;
  rows: Review[] | null;
  weekRange: string;
  error: string;
  onReload: () => void;
  onPublish: (rows: Review[]) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const inFlight = useRef(false);
  const selected =
    rows?.filter(
      (row) => !row.error && selection[row.department_id] !== false,
    ) ?? [];
  const activeError = failure || error;
  const names = Object.fromEntries(
    (["employees", "departments", "sites", "roles"] as const).map((table) => [
      table,
      new Map(data[table].map((item) => [item.id, String(item.name)])),
    ]),
  );
  const worker = (id: string | null) =>
    id ? names.employees.get(id) || "עובד משובץ" : "משמרת פנויה";
  function renderChange(change: ScheduleChange) {
    const { before, after } = change;
    const shift = after || before!;
    const kind = publicationChangeKind(change);
    const details = (entry: typeof shift) => (
      <>
        {date.format(new Date(entry.starts_at))} ·{" "}
        <bdi dir="ltr">
          {shiftClock(entry.starts_at)}–{shiftClock(entry.ends_at)}
        </bdi>
        {" · "}
        {names.sites.get(entry.site_id)} · {names.roles.get(entry.role_id)}
      </>
    );
    const timingChanged =
      before &&
      after &&
      (before.starts_at !== after.starts_at ||
        before.ends_at !== after.ends_at ||
        before.site_id !== after.site_id ||
        before.role_id !== after.role_id);
    return (
      <li key={shift.id} className={styles.change} data-kind={kind}>
        <span className={styles.tag}>{publicationChangeLabels[kind]}</span>
        <strong>
          {before && after && before.employee_id !== after.employee_id ? (
            <>
              {worker(before.employee_id)} <span aria-hidden>←</span>
              <span className="sr-only"> הוחלף ב־</span>{" "}
              {worker(after.employee_id)}
            </>
          ) : (
            worker(shift.employee_id)
          )}
        </strong>
        {timingChanged && <small>לפני · {details(before)}</small>}
        <small>
          {timingChanged && "אחרי · "}
          {details(shift)}
        </small>
      </li>
    );
  }

  async function publish() {
    if (inFlight.current || !selected.length || activeError) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await onPublish(selected);
      onClose();
    } catch (cause) {
      setFailure((cause as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => !open && !inFlight.current && onClose()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={`modal ${styles.dialog}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <header className={styles.header}>
            <div>
              <Dialog.Title>סקירה ופרסום סידור</Dialog.Title>
              <Dialog.Description>
                <bdi dir="ltr">{weekRange}</bdi> · העובדים יראו את העדכון לאחר
                האישור.
              </Dialog.Description>
            </div>
            <Dialog.Close type="button" aria-label="סגירה" disabled={saving}>
              <X size={18} />
            </Dialog.Close>
          </header>
          <div
            className={styles.body}
            aria-busy={rows === null && !activeError}
          >
            {activeError && (
              <p role="alert" className="error">
                {activeError}
              </p>
            )}
            {!rows && !activeError && <p role="status">טוען שינויים לפרסום…</p>}
            {rows?.length === 0 && (
              <p>אין טיוטות לפרסום בשבוע ובמחלקות שנבחרו.</p>
            )}
            {rows?.map((row) => (
              <section key={row.department_id} className={styles.department}>
                <label className={styles.choice}>
                  <input
                    type="checkbox"
                    disabled={saving || !!row.error}
                    checked={
                      !row.error && selection[row.department_id] !== false
                    }
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelection((current) => ({
                        ...current,
                        [row.department_id]: checked,
                      }));
                    }}
                  />
                  <strong>
                    {names.departments.get(row.department_id) || "מחלקה"}
                  </strong>
                  {row.first_publication && (
                    <span className={styles.first}>פרסום ראשון</span>
                  )}
                </label>
                {row.error && (
                  <p className={styles.blocked}>
                    דורש תיקון לפני פרסום · {row.error}
                  </p>
                )}
                {row.open_count > 0 && (
                  <p className={styles.open}>
                    {row.open_count === 1
                      ? "משמרת פנויה אחת"
                      : `${row.open_count} משמרות פנויות`}
                  </p>
                )}
                {row.changes.length ? (
                  <details className={styles.details} open={rows.length === 1}>
                    <summary>
                      <ChevronDown size={15} aria-hidden />{" "}
                      {row.changes.length === 1
                        ? "שינוי אחד"
                        : `${row.changes.length} שינויים`}{" "}
                      · פירוט
                    </summary>
                    <ul>{row.changes.map(renderChange)}</ul>
                  </details>
                ) : (
                  <p className={styles.quiet}>
                    הטיוטה זהה לסידור האחרון שפורסם.
                  </p>
                )}
              </section>
            ))}
          </div>
          <div className={styles.actions}>
            <Dialog.Close type="button" disabled={saving}>
              ביטול
            </Dialog.Close>
            {activeError ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setFailure("");
                  setSelection({});
                  onReload();
                }}
              >
                רענון סקירה
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void publish()}
                disabled={saving || !selected.length}
              >
                {saving ? (
                  <Send size={16} aria-hidden />
                ) : (
                  <Check size={16} aria-hidden />
                )}
                {saving
                  ? "מפרסם…"
                  : selected.length === 1
                    ? "אישור ופרסום למחלקה"
                    : `אישור ופרסום · ${selected.length} מחלקות`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
