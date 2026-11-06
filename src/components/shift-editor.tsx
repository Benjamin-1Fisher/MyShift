"use client";
import { useState } from "react";
import {
  addDays,
  interval,
  localDate,
  type Assignment,
  type Data,
  type Operation,
} from "@/lib/domain";
import { canAssign } from "@/lib/planner";
const clock = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export default function ShiftEditor({
  data,
  shift,
  week,
  date,
  onSave,
  onDelete,
  onCopy,
}: {
  data: Data;
  shift: Assignment | true;
  week: string;
  date: string;
  onSave: (op: Operation) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopy: (shift: Assignment) => void;
}) {
  const original = shift === true ? null : shift;
  const [department, setDepartment] = useState(
    original?.department_id || data.departments[0]?.id || "",
  );
  const [site, setSite] = useState(
    original?.site_id || data.sites[0]?.id || "",
  );
  const [role, setRole] = useState(
    original?.role_id ||
      data.roles.find((r) => r.department_id === department)?.id ||
      "",
  );
  const [day, setDay] = useState(
    original ? localDate(original.starts_at) : date,
  );
  const [start, setStart] = useState(
    original ? clock(original.starts_at) : "07:00",
  );
  const [end, setEnd] = useState(original ? clock(original.ends_at) : "15:00");
  const [employee, setEmployee] = useState(original?.employee_id || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  let candidate: Assignment | null = null;
  try {
    candidate = {
      id: original?.id || "",
      version_id: original?.version_id || "",
      department_id: department,
      site_id: site,
      role_id: role,
      employee_id: employee || null,
      ...interval(day, start, end),
    };
  } catch {}
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="simple-shift-form"
      onSubmit={(e) => {
        e.preventDefault();
        void perform(async () => {
          if (!candidate) throw new Error("יש לבחור תאריך ושעות תקינים");
          await onSave({
            ...candidate,
            kind: original?.id ? "update" : "create",
          } as Operation);
        });
      }}
    >
      <div className="shift-presets" aria-label="שעות מהירות">
        {[
          ["בוקר", "07:00", "15:00"],
          ["ערב", "15:00", "23:00"],
          ["לילה", "23:00", "07:00"],
        ].map(([label, from, to]) => (
          <button
            type="button"
            key={label}
            className={start === from && end === to ? "selected" : ""}
            onClick={() => {
              setStart(from);
              setEnd(to);
            }}
          >
            {label}
            <small dir="ltr">
              {from}–{to}
            </small>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          מחלקה
          <select
            aria-label="מחלקה"
            value={department}
            required
            onChange={(e) => {
              setDepartment(e.target.value);
              setRole(
                data.roles.find((r) => r.department_id === e.target.value)
                  ?.id || "",
              );
              setEmployee("");
            }}
          >
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          אתר
          <select
            aria-label="אתר"
            value={site}
            required
            onChange={(e) => setSite(e.target.value)}
          >
            {data.sites.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          תפקיד
          <select
            aria-label="תפקיד"
            value={role}
            required
            onChange={(e) => {
              setRole(e.target.value);
              setEmployee("");
            }}
          >
            {data.roles
              .filter((r) => r.department_id === department)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.name)}
                </option>
              ))}
          </select>
        </label>
        <label>
          תאריך
          <input
            aria-label="תאריך"
            type="date"
            min={week}
            max={addDays(week, 6)}
            value={day}
            required
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label>
          התחלה
          <input
            aria-label="התחלה"
            type="time"
            value={start}
            required
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          סיום
          <input
            aria-label="סיום"
            type="time"
            value={end}
            required
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <label className="assignment-choice">
        מי עובד במשמרת?
        <select
          aria-label="עובד במשמרת"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        >
          <option value="">ללא עובד — משמרת פנויה</option>
          {data.employees
            .filter(
              (e) =>
                e.active &&
                data.employee_departments.some(
                  (m) =>
                    m.employee_id === e.id &&
                    m.department_id === department &&
                    m.role_id === role,
                ),
            )
            .map((e) => {
              const eligible = !!candidate && canAssign(data, candidate, e.id);
              return (
                <option
                  key={e.id}
                  value={e.id}
                  disabled={!eligible && e.id !== original?.employee_id}
                >
                  {String(e.name)}
                  {!eligible ? " · לא זמין בשעות האלה" : ""}
                </option>
              );
            })}
        </select>
      </label>
      <p className="muted">
        אפשר להשאיר ללא עובד ולשבץ בהמשך. משמרת לילה מסתיימת ביום הבא.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="primary" disabled={busy}>
          {busy ? "שומר…" : "שמירת משמרת"}
        </button>
        {original?.id && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCopy(original)}
            >
              שכפול משמרת
            </button>
            <button
              className="danger compact"
              type="button"
              disabled={busy}
              onClick={() => void perform(onDelete)}
            >
              מחיקת משמרת
            </button>
          </>
        )}
      </div>
    </form>
  );
}
