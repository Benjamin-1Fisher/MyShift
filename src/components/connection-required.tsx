import { Database, ShieldCheck, CheckCircle2 } from "lucide-react";
export default function ConnectionRequired() {
  return (
    <main className="connection-page">
      <section className="connection-card">
        <span className="brand-icon">
          <ShieldCheck />
        </span>
        <p className="eyebrow">MyShift · הקמת מערכת קבועה</p>
        <h1>מחברים את הארגון, ואז מתחילים לעבוד</h1>
        <p>
          ניהול עובדים וסידורים דורש מסד נתונים קבוע וחיבור מאובטח. החיבור הזה
          עדיין לא הוגדר, ולכן המערכת אינה פתוחה לעריכה כרגע.
        </p>
        <div className="setup-banner">
          <Database />
          <strong>טרם חובר מסד הנתונים של הארגון</strong>
        </div>
        <ol className="connection-steps">
          <li>
            <strong>יצירת פרויקט Supabase</strong>
            <p>
              בחשבון של הארגון יוצרים פרויקט ומגדירים את כתובת הפרויקט והמפתח
              הציבורי בהגדרות האחסון.
            </p>
            <a
              className="button primary"
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
            >
              פתיחת Supabase
            </a>
          </li>
          <li>
            <strong>התקנת המסד ויצירת מנהל ראשי</strong>
            <p>
              מריצים את ארבע המיגרציות שבתיקיית supabase/migrations לפי הסדר,
              יוצרים חשבון מנהל ומעניקים לו הרשאה לפי הוראות ההתקנה.
            </p>
          </li>
          <li>
            <strong>פריסה בחשבון הארגון</strong>
            <p>
              מגדירים את אותם פרטי החיבור ב־Vercel ומבצעים פריסה קבועה. לאחר מכן
              ניתן להתחבר, להוסיף עובדים וליצור סידור.
            </p>
            <a
              className="button"
              href="https://vercel.com/dashboard"
              target="_blank"
              rel="noreferrer"
            >
              פתיחת Vercel
            </a>
          </li>
        </ol>
        <p className="muted">
          <CheckCircle2 size={16} /> הנתונים יישמרו במסד משותף ויהיו זמינים
          למנהלים המורשים. אין להשתמש בקישור זמני לניהול תפעולי.
        </p>
      </section>
    </main>
  );
}
