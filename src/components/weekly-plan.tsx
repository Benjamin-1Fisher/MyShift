import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, ShieldCheck, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { localDate, type Data, type Operation, type Row } from "@/lib/domain";
import { planWeek } from "@/lib/planner";
import DepartmentSelect from "./department-select";
import styles from "./weekly-plan.module.css";

type PlanTarget = {
  week: string;
  departmentId: string;
  versionId?: string;
  revision: number;
};

export type ApplyWeeklyPlan = (
  operations: Operation[],
  target: PlanTarget,
) => Promise<void>;

type Plan = {
  operations: ReturnType<typeof planWeek>;
  target: PlanTarget;
  message?: string;
};

const dateFormatter = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "numeric",
  month: "numeric",
  timeZone: "Asia/Jerusalem",
});
const timeFormatter = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

function preparePlan(data: Data, week: string, departmentId: string): Plan {
  const versions = data.schedule_versions.filter(
    (row) => row.week_start === week && row.department_id === departmentId,
  );
  const version = versions.find((row) => row.status !== "archived");
  const target = {
    week,
    departmentId,
    versionId: version?.id,
    revision: Number(version?.revision || 0),
  };
  if (version?.status === "published") {
    return {
      operations: [],
      target,
      message: "הסידור למחלקה כבר פורסם. אפשר לפתוח אותו לעריכה מעמוד המחלקה.",
    };
  }
  if (!version && versions.length) {
    return {
      operations: [],
      target,
      message: "הסידור למחלקה נמצא בסל המחזור. אפשר לשחזר אותו מעמוד המחלקה.",
    };
  }
  const configured =
    data.coverage_requirements.some((r) => r.department_id === departmentId) ||
    data.shift_templates.some(
      (t) =>
        t.department_id === departmentId &&
        t.confirmed &&
        t.start_time &&
        t.end_time,
    );
  const hasOpenShift = data.shift_assignments.some(
    (shift) => shift.version_id === version?.id && !shift.employee_id,
  );
  try {
    const operations = planWeek(
      data,
      week,
      configured || !hasOpenShift ? "generate" : "fill",
      departmentId,
    );
    return { operations, target };
  } catch (error) {
    return { operations: [], target, message: (error as Error).message };
  }
}

export default function WeeklyPlan({
  data,
  departments,
  departmentId,
  week,
  dateRange,
  names,
  onApply,
}: {
  data: Data;
  departments: Row[];
  departmentId: string;
  week: string;
  dateRange: ReactNode;
  names: Record<"employees" | "sites" | "roles", Map<string, string>>;
  onApply: ApplyWeeklyPlan;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const committing = useRef(false);
  const days = new Map<string, Plan["operations"]>();
  for (const operation of plan?.operations || []) {
    const date = localDate(operation.starts_at);
    const day = days.get(date);
    if (day) day.push(operation);
    else days.set(date, [operation]);
  }
  const additions =
    plan?.operations.filter((op) => op.kind === "create").length ?? 0;
  const placements =
    plan?.operations.filter((op) => op.employee_id).length ?? 0;

  function showPlan(id: string) {
    setError("");
    setPlan(preparePlan(data, week, id));
  }

  async function apply() {
    if (!plan?.operations.length || committing.current) return;
    committing.current = true;
    setSaving(true);
    try {
      await onApply(plan.operations, plan.target);
      setOpen(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      committing.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (committing.current) return;
        if (open) showPlan(departmentId || departments[0].id);
        setOpen(open);
      }}
    >
      <Dialog.Trigger type="button" className={styles.trigger}>
        <CalendarPlus size={17} aria-hidden /> תכנון שבועי
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={`overlay ${styles.overlay}`} />
        <Dialog.Content className={`modal ${styles.dialog}`}>
          <header className={styles.heading}>
            <div>
              <Dialog.Title>תכנון שבועי</Dialog.Title>
              <Dialog.Description>
                תצוגה מקדימה · {dateRange}
              </Dialog.Description>
            </div>
            <Dialog.Close type="button" aria-label="סגירה" disabled={saving}>
              <X size={18} aria-hidden />
            </Dialog.Close>
          </header>
          {plan && (
            <>
              <div className={styles.scope}>
                <fieldset disabled={saving}>
                  <span className={styles.scopeLabel}>מחלקה לתכנון</span>
                  <DepartmentSelect
                    departments={departments}
                    value={plan.target.departmentId}
                    label="מחלקה לתכנון"
                    onChange={showPlan}
                  />
                </fieldset>
                <p className={styles.protection}>
                  <ShieldCheck aria-hidden size={18} />
                  השיבוצים הקיימים נשמרים. ההצעה תישמר כטיוטה רק לאחר אישור.
                </p>
              </div>
              <div className={styles.preview} aria-live="polite">
                {plan.operations.length ? (
                  <>
                    <div className={styles.summary}>
                      <span>
                        <strong>{additions}</strong> משמרות חדשות
                      </span>
                      <span>
                        <strong>{placements}</strong> שיבוצים מוצעים
                      </span>
                    </div>
                    {Array.from(days, ([day, operations]) => (
                      <section key={day} className={styles.day}>
                        <h3>
                          {dateFormatter.format(new Date(`${day}T12:00:00Z`))}
                        </h3>
                        <ul>
                          {operations.map((op) => (
                            <li key={op.id}>
                              <div>
                                <strong>
                                  {op.employee_id
                                    ? names.employees.get(op.employee_id) ||
                                      "עובד משובץ"
                                    : "פנויה לשיבוץ"}
                                </strong>
                                <small>
                                  {names.sites.get(op.site_id)} ·{" "}
                                  {names.roles.get(op.role_id)}
                                </small>
                              </div>
                              <bdi dir="ltr">
                                {timeFormatter.format(Date.parse(op.starts_at))}
                                –{timeFormatter.format(Date.parse(op.ends_at))}
                              </bdi>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </>
                ) : (
                  <p className={styles.empty}>
                    {plan.message ||
                      "אין כרגע משמרות להוסיף או שיבוצים פנויים שאפשר למלא."}
                  </p>
                )}
              </div>
              <footer className={styles.actions}>
                {error && <p role="alert">{error}</p>}
                <Dialog.Close type="button" disabled={saving}>
                  {plan.operations.length ? "ביטול" : "סגירה"}
                </Dialog.Close>
                {plan.operations.length > 0 && (
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={
                      error ? () => showPlan(plan.target.departmentId) : apply
                    }
                  >
                    {saving
                      ? "שומר…"
                      : error
                        ? "רענון הצעה"
                        : "אישור ושמירה כטיוטה"}
                  </button>
                )}
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
