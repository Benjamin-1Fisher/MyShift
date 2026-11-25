import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, ChevronDown, ShieldCheck, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { localDate, type Data, type Row } from "@/lib/domain";
import {
  planDepartments,
  type WeeklyPlanGroup,
  type WeeklyPlanTarget,
} from "@/lib/planner";
import DepartmentSelect from "./department-select";
import styles from "./weekly-plan.module.css";

export type ApplyWeeklyPlan = (targets: WeeklyPlanTarget[]) => Promise<void>;
type Operation = WeeklyPlanTarget["operations"][number];
type Names = Record<"employees" | "sites" | "roles", Map<string, string>>;
type Plan = {
  id: number;
  groups: WeeklyPlanGroup[];
  departmentId: string;
};

const allDepartments = { id: "", name: "כל המחלקות שבניהולי" };

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

const additionLabel = (count: number) =>
  count === 1 ? "משמרת חדשה" : "משמרות חדשות";
const fillLabel = (count: number) =>
  count === 1 ? "מילוי משמרת פנויה" : "מילויי משמרות פנויות";

function PlanDepartment({
  group,
  names,
}: {
  group: WeeklyPlanGroup;
  names: Names;
}) {
  const { department, target, unavailable } = group;
  const additions = target.operations.filter(
    (operation) => operation.kind === "create",
  ).length;
  const fills = target.operations.length - additions;
  const name = String(department.name);

  const days = new Map<string, Operation[]>();
  for (const operation of target.operations) {
    const date = localDate(operation.starts_at);
    const day = days.get(date);
    if (day) day.push(operation);
    else days.set(date, [operation]);
  }

  return (
    <details className={styles.department} aria-label={name}>
      <summary>
        <span className={styles.departmentInfo}>
          <strong>{name}</strong>
          <span className={styles.counts}>
            {unavailable && <span>{unavailable.label}</span>}
            {additions > 0 && (
              <span data-kind="create">
                {additions} {additionLabel(additions)}
              </span>
            )}
            {fills > 0 && (
              <span data-kind="update">
                {fills} {fillLabel(fills)}
              </span>
            )}
          </span>
        </span>
        <ChevronDown size={17} aria-hidden />
      </summary>
      {unavailable && <p className={styles.reason}>{unavailable.detail}</p>}
      {Array.from(days, ([day, operations]) => (
        <section key={day} className={styles.day}>
          <h3>{dateFormatter.format(new Date(`${day}T12:00:00Z`))}</h3>
          <ul>
            {operations.map((operation) => (
              <li key={operation.id} data-kind={operation.kind}>
                <div>
                  <span className={styles.kind}>
                    {operation.kind === "create"
                      ? "משמרת חדשה"
                      : "מילוי משמרת פנויה"}
                  </span>
                  <strong>
                    {operation.employee_id
                      ? names.employees.get(operation.employee_id) ||
                        "עובד משובץ"
                      : "פנויה לשיבוץ"}
                  </strong>
                  <small>
                    {names.sites.get(operation.site_id)} ·{" "}
                    {names.roles.get(operation.role_id)}
                  </small>
                </div>
                <bdi dir="ltr">
                  {timeFormatter.format(Date.parse(operation.starts_at))}–
                  {timeFormatter.format(Date.parse(operation.ends_at))}
                </bdi>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  );
}

export default function WeeklyPlan({
  data,
  departments,
  week,
  dateRange,
  names,
  onApply,
}: {
  data: Data;
  departments: Row[];
  week: string;
  dateRange: ReactNode;
  names: Names;
  onApply: ApplyWeeklyPlan;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const committing = useRef(false);
  const scope = useRef<HTMLFieldSetElement>(null);
  const targets =
    plan?.groups
      .map((group) => group.target)
      .filter((target) => target.operations.length) ?? [];
  const hasTargets = targets.length > 0;
  const additions = targets.reduce(
    (count, target) =>
      count +
      target.operations.filter((operation) => operation.kind === "create")
        .length,
    0,
  );
  const fills =
    targets.reduce((count, target) => count + target.operations.length, 0) -
    additions;

  function showPlan(departmentId: string) {
    setError("");
    const groups = planDepartments(
      data,
      week,
      departmentId
        ? departments.filter((department) => department.id === departmentId)
        : departments,
    );
    setPlan((previous) => ({
      id: (previous?.id ?? 0) + 1,
      departmentId,
      groups,
    }));
  }

  async function apply() {
    if (!hasTargets || committing.current) return;
    committing.current = true;
    setSaving(true);
    try {
      await onApply(targets);
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
        if (open) showPlan("");
        setOpen(open);
      }}
    >
      <Dialog.Trigger type="button" className={styles.trigger}>
        <CalendarPlus size={17} aria-hidden /> תכנון שבועי
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={`overlay ${styles.overlay}`} />
        <Dialog.Content
          className={`modal ${styles.dialog}`}
          onEscapeKeyDown={(event) => {
            if (scope.current?.querySelector('[aria-expanded="true"]'))
              event.preventDefault();
          }}
        >
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
                <fieldset disabled={saving} ref={scope}>
                  <DepartmentSelect
                    departments={[allDepartments, ...departments]}
                    value={plan.departmentId}
                    label="היקף תכנון"
                    onChange={showPlan}
                  />
                </fieldset>
                <p className={styles.protection}>
                  <ShieldCheck aria-hidden size={18} />
                  השיבוצים הקיימים נשמרים. ההצעה תישמר כטיוטה רק לאחר אישור.
                </p>
              </div>
              <div className={styles.preview} key={plan.id}>
                <div className={styles.summary} role="status">
                  <span data-kind="create">
                    <strong>{additions}</strong> {additionLabel(additions)}
                  </span>
                  <span data-kind="update">
                    <strong>{fills}</strong> {fillLabel(fills)}
                  </span>
                </div>
                {plan.groups.map((group) => (
                  <PlanDepartment
                    key={group.department.id}
                    group={group}
                    names={names}
                  />
                ))}
                {plan.groups.length === 0 && (
                  <p className={styles.reason}>אין מחלקות לתכנון.</p>
                )}
              </div>
              <footer className={styles.actions}>
                {error && <p role="alert">{error}</p>}
                <Dialog.Close type="button" disabled={saving}>
                  {hasTargets ? "ביטול" : "סגירה"}
                </Dialog.Close>
                {hasTargets && (
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={error ? () => showPlan(plan.departmentId) : apply}
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
