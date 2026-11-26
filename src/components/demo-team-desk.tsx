import { useState } from "react";
import { Cake, FileText, Send } from "lucide-react";
import { addDays, localDate, type Row } from "@/lib/domain";
import { demoRead } from "./employee-payroll";
import { DEMO_RECEIPTS_KEY } from "@/lib/demo-storage";

const people = [
  ["000000000020", "11-25"],
  ["000000000021", "11-28"],
  ["000000000022", "12-04"],
  ["000000000023", "01-15"],
  ["000000000024", "03-02"],
  ["000000000025", "05-20"],
  ["000000000026", "07-12"],
  ["000000000027", "09-15"],
  ["000000000800", "02-09"],
  ["000000000801", "04-27"],
  ["000000000810", "06-07"],
  ["000000000811", "08-17"],
] as const;
const fixtures = new Map<string, string>(
  people.map(([tail, birthday]) => [
    "20000000-0000-4000-8000-" + tail,
    birthday,
  ]),
);
type Receipt = { employeeId: string; month: string };
function validReceipt(value: unknown): value is Receipt {
  const r = value as Partial<Receipt> | null;
  return (
    !!r &&
    typeof r.employeeId === "string" &&
    fixtures.has(r.employeeId) &&
    typeof r.month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)
  );
}
function loadReceipts(): Receipt[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DEMO_RECEIPTS_KEY) || "[]");
    const list = Array.isArray(saved) ? saved.filter(validReceipt) : [];
    for (const employeeId of fixtures.keys()) {
      for (const slip of demoRead(employeeId, false).slips) {
        if (!list.some((r) => r.employeeId === employeeId && r.month === slip.period))
          list.push({ employeeId, month: slip.period });
      }
    }
    return list;
  } catch {
    return [];
  }
}
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(month + "-15T12:00:00Z"));

export default function DemoTeamDesk({
  employees,
  employeeId,
  canEdit,
}: {
  employees: Row[];
  employeeId: string;
  canEdit: boolean;
}) {
  const demoPeople = employees.filter(
    (person) => person.active && fixtures.has(person.id),
  );
  const [today] = useState(() => localDate(new Date().toISOString()));
  const month = addDays(today.slice(0, 7) + "-01", -1).slice(0, 7);
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState("");
  const [receipts, setReceipts] = useState(loadReceipts);
  const safeTarget =
    demoPeople.find((person) => person.id === target) ?? demoPeople[0];
  const alreadySent = receipts.some(
    (r) => r.employeeId === safeTarget?.id && r.month === month,
  );
  const birthdays = Array.from({ length: 31 }, (_, i) =>
    addDays(today, i),
  ).flatMap((day, offset) =>
    demoPeople
      .filter((person) => fixtures.get(person.id) === day.slice(5))
      .map((person) => ({ date: day, offset, person })),
  );
  const own = receipts
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => b.month.localeCompare(a.month));

  const sentThisMonth = new Set(
    receipts.filter((r) => r.month === month).map((r) => r.employeeId),
  );
  const remaining = demoPeople.filter(
    (person) => !sentThisMonth.has(person.id),
  ).length;

  function sendDemoSlips(ids: string[], batch: boolean) {
    if (!canEdit) return;
    const allowed = new Set(demoPeople.map((person) => person.id));
    const next = [...loadReceipts()];
    const sent = new Set(
      next.filter((r) => r.month === month).map((r) => r.employeeId),
    );
    const pending = [...new Set(ids)].filter(
      (id) => allowed.has(id) && !sent.has(id),
    );
    for (const employeeId of pending) next.push({ employeeId, month });
    if (!pending.length) {
      setReceipts(next);
      return;
    }
    try {
      localStorage.setItem(DEMO_RECEIPTS_KEY, JSON.stringify(next));
      setReceipts(next);
      setStatus(
        batch
          ? `נשלחו ${pending.length} תלושי דוגמה לתיבות האישיות בהדגמה.`
          : "תלוש הדוגמה נשלח לתיבה האישית בהדגמה.",
      );
    } catch {
      setStatus("הדפדפן לא שמר את השליחה. לא נשלח תלוש.");
    }
  }

  if (!canEdit)
    return (
      <section className="panel" aria-label="תיבת תלושים אישית">
        <h2>
          <FileText aria-hidden size={19} /> התלושים שלי
        </h2>
        <p className="muted">
          תצוגת דוגמה בדפדפן בלבד. אין כאן תלושי שכר אמיתיים.
        </p>
        {own.length === 0 ? (
          <p role="status">אין תלושי דוגמה בתיבה שלך.</p>
        ) : (
          own.map((r) => (
            <details className="team-slip" key={r.month}>
              <summary>תלוש דוגמה · {monthLabel(r.month)}</summary>
              <p>חודש שכר: {monthLabel(r.month)}. המספרים להמחשה בלבד.</p>
              <dl>
                <dt>ברוטו לדוגמה</dt>
                <dd>₪8,400</dd>
                <dt>נטו לדוגמה</dt>
                <dd>₪7,360</dd>
              </dl>
            </details>
          ))
        )}
      </section>
    );

  return (
    <section className="team-desk" aria-label="תלושים ותזכורות בדמו">
      <div className="alert">
        נתוני דוגמה בלבד. אין שליחה בדוא״ל או בהודעה, ואין להזין כאן מידע אישי
        אמיתי.
      </div>
      <div className="team-panels">
        <section className="panel">
          <h2>
            <FileText aria-hidden size={19} /> שליחת תלוש אישי
          </h2>
          <p>
            שולחים תלוש דוגמה עבור {monthLabel(month)} לתיבה האישית של עובד אחד.
          </p>
          <label className="team-select">
            בחר עובד
            <select
              value={safeTarget?.id ?? ""}
              onChange={(e) => {
                setTarget(e.target.value);
                setStatus("");
              }}
            >
              {!safeTarget && <option value="">אין עובדים בדמו</option>}
              {demoPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {String(person.name)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!safeTarget || alreadySent}
            onClick={() => safeTarget && sendDemoSlips([safeTarget.id], false)}
          >
            <Send aria-hidden size={16} />{" "}
            {alreadySent ? "נשלח בדמו" : "שלח תלוש דוגמה"}
          </button>
          <button
            className="team-bulk"
            type="button"
            disabled={!remaining}
            onClick={() =>
              sendDemoSlips(
                demoPeople.map((person) => person.id),
                true,
              )
            }
          >
            שלח לכל עובדי הדמו ({remaining} נותרו)
          </button>
          {status && <p role="status">{status}</p>}
          {alreadySent && (
            <small>אפשר לעבור לתצוגת העובד כדי לראות את התלוש בתיבה שלו.</small>
          )}
        </section>
        <section className="panel" aria-label="תזכורות יום הולדת">
          <h2>
            <Cake aria-hidden size={19} /> ימי הולדת קרובים
          </h2>
          <p className="muted">
            תזכורות למנהל ל־30 הימים הקרובים. תאריכי דוגמה בלבד.
          </p>
          {birthdays.length ? (
            <ul className="team-birthdays">
              {birthdays.map(({ date, offset, person }) => (
                <li key={person.id}>
                  <strong>{String(person.name)}</strong>
                  <span>
                    {offset === 0
                      ? "היום"
                      : offset === 1
                        ? "מחר"
                        : "בעוד " + offset + " ימים"}
                  </span>
                  <time dateTime={date}>
                    <bdi dir="ltr">
                      {date.slice(5).split("-").reverse().join(".")}
                    </bdi>
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p>אין ימי הולדת קרובים בנתוני הדוגמה.</p>
          )}
        </section>
      </div>
    </section>
  );
}
