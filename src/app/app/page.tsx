import Link from "next/link";
import Workspace from "@/components/workspace";
export default function ProductionPage() {
  const configured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  if (configured) return <Workspace configured />;
  return (
    <main className="connection-page">
      <section className="connection-card">
        <p className="eyebrow">MyShift · סביבת הארגון</p>
        <h1>המערכת הארגונית עדיין לא מחוברת</h1>
        <p>
          נתוני אמת נשמרים במסד הארגון לאחר חיבור וכניסה מאובטחת. בינתיים אפשר
          להכיר את המערכת בהדגמה עם נתונים לדוגמה.
        </p>
        <div className="row">
          <Link className="button primary" href="/demo">
            כניסה להדגמה
          </Link>
          <Link className="button" href="/setup">
            הגדרת המערכת הארגונית
          </Link>
          <Link className="button" href="/">
            חזרה
          </Link>
        </div>
      </section>
    </main>
  );
}
