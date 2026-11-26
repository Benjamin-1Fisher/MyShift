import { useEffect, useState } from "react";
import { DEMO_PAYROLL_KEY, DEMO_RECEIPTS_KEY } from "@/lib/demo-storage";
import { localDate } from "@/lib/domain";

type Config = {
  basis: "hourly" | "monthly";
  rate: number;
  method: "transfer" | "check" | "cash";
  consent: string | null;
};
type Slip = {
  id: string;
  period: string;
  sent: string | null;
  received: string | null;
  revision: string | null;
};
type Snapshot = { config: Config | null; linked: boolean; slips: Slip[] };
const money = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
});
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(value));
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(value + "-15T12:00:00Z"));
type DemoRow = { config?: Config; slips: Slip[] };
const demoState = (): Record<string, DemoRow> =>
  JSON.parse(localStorage.getItem(DEMO_PAYROLL_KEY) || "{}");
const demoReceipts = (): { employeeId: string; month: string }[] =>
  JSON.parse(localStorage.getItem(DEMO_RECEIPTS_KEY) || "[]");
export function demoRead(id: string, manager: boolean): Snapshot {
  const row = demoState()[id];
  const slips = new Map((row?.slips ?? []).map((s) => [s.period, s]));
  for (const receipt of demoReceipts().filter((r) => r.employeeId === id)) {
    if (
      !slips.get(receipt.month)?.sent &&
      /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(receipt.month)
    )
      slips.set(receipt.month, {
        id: receipt.month,
        period: receipt.month,
        sent: receipt.month + "-01T12:00:00Z",
        received: null,
        revision: null,
      });
  }
  return {
    config: manager ? (row?.config ?? null) : null,
    linked: manager,
    slips: [...slips.values()]
      .filter((s) => manager || s.sent)
      .sort((a, b) => b.period.localeCompare(a.period)),
  };
}
function defaultPeriod() {
  const month = localDate(new Date().toISOString()).slice(0, 7);
  const date = new Date(month + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
export default function EmployeePayroll({
  id,
  manager,
  demo,
  active,
}: {
  id: string;
  manager: boolean;
  demo: boolean;
  active: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [basis, setBasis] = useState<Config["basis"]>("hourly");
  const [rate, setRate] = useState("");
  const [method, setMethod] = useState<Config["method"]>("transfer");
  const [consent, setConsent] = useState("");
  const [month, setMonth] = useState(defaultPeriod);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<Slip | null>(null);
  const endpoint = "/api/payroll?employee=" + encodeURIComponent(id);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function setup() {
      try {
        const next = demo
          ? demoRead(id, manager)
          : await fetch(endpoint, {
              signal: controller.signal,
              cache: "no-store",
            }).then(parseResponse);
        if (!alive) return;
        setData(next);
        if (next.config) {
          setBasis(next.config.basis);
          setRate(String(next.config.rate / 100));
          setMethod(next.config.method);
          setConsent(next.config.consent ?? "");
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "לא ניתן לטעון תלושים.");
      }
    }
    void setup();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, demo, manager, endpoint]);

  async function action(
    command: string,
    payload: object,
    notice: string,
    local: (row: DemoRow) => void,
  ) {
    if (busy || !data) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (demo) {
        const state = demoState();
        // Include slips delivered from the existing demo desk.
        const row = state[id] ?? { slips: [] };
        row.slips = demoRead(id, true).slips;
        local(row);
        state[id] = row;
        localStorage.setItem(DEMO_PAYROLL_KEY, JSON.stringify(state));
        setData(demoRead(id, manager));
      } else {
        await parseResponse(
          await fetch("/api/payroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId: id, command, payload }),
          }),
        );
        try {
          setData(
            await parseResponse(await fetch(endpoint, { cache: "no-store" })),
          );
        } catch {
          setData(null);
          throw new Error(
            "הפעולה נשמרה. יש לפתוח מחדש כדי לראות את המצב המעודכן.",
          );
        }
      }
      setMessage(notice);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפעולה לא נשמרה.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (busy || !data) return;
    let pdf = "";
    if (!demo) {
      if (!file || file.size > 1_048_576) {
        setError("בחרו קובץ PDF עד 1 MB.");
        return;
      }
      try {
        pdf = btoa(
          Array.from(new Uint8Array(await file.arrayBuffer()), (n) =>
            String.fromCharCode(n),
          ).join(""),
        );
      } catch {
        setError("לא ניתן לקרוא את הקובץ.");
        return;
      }
    }
    const current = data.slips.find((s) => s.period === month);
    if (current?.sent) {
      setError("כבר נשלח תלוש לחודש הזה.");
      return;
    }
    await action(
      "upload",
      { period: month, pdf },
      demo ? "תלוש דוגמה הוכן." : "קובץ השכר נשמר כטיוטה.",
      (row) => {
        row.slips = row.slips.filter((s) => s.period !== month);
        row.slips.push({
          id: month,
          period: month,
          sent: null,
          received: null,
          revision: crypto.randomUUID(),
        });
      },
    );
  }
  return (
    <div className="payroll-desk">
      {demo && (
        <p className="alert">
          הדגמה בלבד. השתמשו בנתונים בדיוניים. לא מתבצע תשלום ולא נשלחת הודעה
          חיצונית.
        </p>
      )}
      {!data && !error && <p role="status">טוען תלושים…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && manager && (
        <>
          <form
            className="panel payroll-panel"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !/^\d{1,7}(\.\d{1,2})?$/.test(rate) ||
                Number(rate) < 0.01 ||
                Number(rate) > 1000000
              ) {
                setError("הזינו סכום תקין בשקלים, עד שתי ספרות אחרי הנקודה.");
                return;
              }
              const config: Config = {
                basis,
                rate: Math.round(Number(rate) * 100),
                method,
                consent: consent || null,
              };
              void action("settings", config, "הגדרות השכר נשמרו.", (row) => {
                row.config = config;
              });
            }}
          >
            <h3>הגדרות שכר</h3>
            <p className="muted">
              לתיעוד בלבד. המערכת לא מחשבת נטו ולא מעבירה תשלום.
            </p>
            <div className="payroll-fields">
              <label>
                בסיס שכר
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as Config["basis"])}
                >
                  <option value="hourly">שעתי</option>
                  <option value="monthly">חודשי</option>
                </select>
              </label>
              <label>
                {basis === "hourly" ? "תעריף לשעה (₪)" : "שכר בסיס לחודש (₪)"}
                <input
                  inputMode="decimal"
                  required
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
              <label>
                אמצעי תשלום
                <select
                  value={method}
                  onChange={(e) =>
                    setMethod(e.target.value as Config["method"])
                  }
                >
                  <option value="transfer">העברה בנקאית</option>
                  <option value="check">המחאה</option>
                  <option value="cash">מזומן</option>
                </select>
              </label>
              <label>
                {demo
                  ? "תאריך הסכמה לדוגמה"
                  : "תאריך הסכמה מתועדת למסירה דיגיטלית"}
                <input
                  type="date"
                  min="2000-01-01"
                  max={localDate(new Date().toISOString())}
                  disabled={!data.linked}
                  value={consent}
                  onChange={(e) => setConsent(e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              {data.linked
                ? "השאירו תאריך ריק אם אין הסכמה או אם בוטלה."
                : "יש לשייך חשבון אישי לעובד לפני אישור מסירה דיגיטלית."}
            </p>
            <button className="primary" type="submit" disabled={busy}>
              שמור הגדרות שכר
            </button>
          </form>
          <form
            className="panel payroll-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void upload();
            }}
          >
            <h3>{demo ? "הכנת תלוש דוגמה" : "העלאת תלוש מחשבות השכר"}</h3>
            <div className="payroll-fields">
              <label>
                חודש שכר
                <input
                  type="month"
                  value={month}
                  min="2000-01"
                  max="2100-12"
                  required
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              {!demo && (
                <label>
                  תלוש PDF, עד 1 MB
                  <input
                    type="file"
                    required
                    accept="application/pdf,.pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
            <button type="submit" disabled={busy}>
              {demo ? "הכן תלוש דוגמה" : "שמור כטיוטה"}
            </button>
          </form>
        </>
      )}
      {data && (
        <section className="panel payroll-panel" aria-label="היסטוריית תלושים">
          <h3>{manager ? "היסטוריית תלושים" : "התלושים שלי"}</h3>
          {!data.slips.length && <p>אין תלושים להצגה.</p>}
          {data.slips.map((s) => (
            <div className="payroll-slip" key={s.id}>
              <strong>{monthLabel(s.period)}</strong>
              <span className="badge">
                {s.received
                  ? "הקבלה אושרה"
                  : s.sent
                    ? "בתיבה האישית, ממתין לאישור"
                    : "טיוטה"}
              </span>
              {s.sent && (
                <small>
                  נשלח {dateLabel(s.sent)}
                  {s.received ? " · אושר " + dateLabel(s.received) : ""}
                </small>
              )}
              {demo ? (
                <button
                  type="button"
                  onClick={() =>
                    setPdfPreview(pdfPreview?.id === s.id ? null : s)
                  }
                >
                  תצוגת דוגמה
                </button>
              ) : (
                <a
                  className="button"
                  href={endpoint + "&slip=" + encodeURIComponent(s.id)}
                >
                  הורדת PDF
                </a>
              )}
              {demo && pdfPreview?.id === s.id && (
                <p>
                  דוגמה בלבד · ברוטו {money.format(8400)} · נטו{" "}
                  {money.format(7360)}
                </p>
              )}
              {manager && !s.sent && (
                <>
                  <button
                    type="button"
                    disabled={
                      busy || !data.linked || !data.config?.consent || !active
                    }
                    onClick={() => setConfirm(s.id)}
                  >
                    שלח לתיבה האישית
                  </button>
                  {(!data.config?.consent || !data.linked || !active) && (
                    <small>נדרשים עובד פעיל, חשבון משויך והסכמה מתועדת.</small>
                  )}
                  {confirm === s.id && (
                    <div
                      className="row"
                      role="group"
                      aria-label="אישור שליחת תלוש"
                    >
                      <span>
                        אשרו שהקובץ והחודש תואמים לעובד שמופיע בכותרת.
                      </span>
                      <button type="button" onClick={() => setConfirm(null)}>
                        ביטול
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          busy ||
                          !data.linked ||
                          !data.config?.consent ||
                          !active
                        }
                        onClick={() =>
                          void action(
                            "publish",
                            { slipId: s.id, revision: s.revision },
                            "התלוש פורסם בתיבה האישית.",
                            (row) => {
                              const item = row.slips.find(
                                (it) => it.id === s.id,
                              );
                              if (item && !item.sent)
                                item.sent = new Date().toISOString();
                            },
                          )
                        }
                      >
                        אשר שליחה
                      </button>
                    </div>
                  )}
                </>
              )}
              {!manager && s.sent && !s.received && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      "receipt",
                      { slipId: s.id },
                      "אישור הקבלה נשמר.",
                      (row) => {
                        const item = row.slips.find((it) => it.id === s.id);
                        if (item) item.received = new Date().toISOString();
                      },
                    )
                  }
                >
                  אישור קבלה
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
async function parseResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "הפעולה לא בוצעה.");
  return data;
}
