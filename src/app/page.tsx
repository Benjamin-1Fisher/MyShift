import Link from "next/link";
import {
  ArrowUpLeft,
  CalendarDays,
  Check,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import HomeSchedule from "@/components/home-schedule";

export default function Page() {
  return (
    <main className="welcome-page">
      <header className="welcome-nav">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <ShieldCheck />
          </span>
          MyShift<span className="brand-dot">.</span>
        </Link>
        <div className="row">
          <span className="welcome-label">ניהול צוותים ומשמרות</span>
          <Link className="button" href="/app">
            כניסה למערכת הארגונית
          </Link>
        </div>
      </header>
      <section className="welcome-hero">
        <div className="welcome-copy">
          <span className="eyebrow">הצוות במקום הנכון. המנהל בתמונה.</span>
          <h1>
            סידור עבודה ברור.
            <br />
            <span>צוות שמוכן למשמרת.</span>
          </h1>
          <p>
            כל מה שצריך לניהול אחמ״שים וסיירים: עובדים, שיבוץ, משמרות ופרסום
            סידור שבועי — במרחב אחד, פשוט ובעברית.
          </p>
          <div className="welcome-actions">
            <Link className="button primary" href="/demo">
              כניסה להדגמה <ArrowUpLeft size={20} />
            </Link>
            <Link className="button" href="/app">
              כניסה לארגון שלי
            </Link>
          </div>
          <p className="welcome-disclosure">
            <Check size={17} /> ללא הרשמה · נתונים לדוגמה · השינויים נשמרים
            בדפדפן בלבד
          </p>
          <div className="welcome-features">
            <span>
              <Users size={18} /> אחמ״שים וסיירים
            </span>
            <span>
              <CalendarDays size={18} /> סידור שבועי
            </span>
            <span>
              <Sparkles size={18} /> עוזר AI <b>בקרוב</b>
            </span>
          </div>
        </div>
      </section>
      <HomeSchedule />
      <section className="welcome-steps" aria-label="מה אפשר לנסות בהדגמה">
        {[
          ["01", "בונים את הצוות", "מוסיפים עובדים ומשייכים לתפקיד ולמחלקה."],
          ["02", "משבצים בביטחון", "יוצרים משמרות ובודקים חפיפות לפני האישור."],
          [
            "03",
            "מפרסמים סידור",
            "מפרסמים מקומית ורואים את הסידור בתצוגת עובד.",
          ],
        ].map(([n, title, text]) => (
          <article key={n}>
            <span>{n}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <footer className="welcome-footer">
        <span>MyShift · מקום אחד לצוות שלם</span>
        <Link href="/setup">הגדרה וחיבור המערכת לארגון</Link>
      </footer>
    </main>
  );
}
