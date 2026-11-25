import { useState } from "react";
import { CalendarDays, Clock3, Plus, ShieldCheck } from "lucide-react";
import type { Row } from "@/lib/domain";
import styles from "./workspace-management.module.css";

type ScheduleSettingsProps = {
  templates: Row[];
  requirements: Row[];
  sites: Row[];
  roles: Row[];
  days: string[];
  onTemplate: (template?: Row) => void;
  onCoverage: (requirement?: Row) => void;
  onRestRules?: () => void;
  onPermissions?: () => void;
};

function TimeRange({ item }: { item: Row }) {
  return (
    <bdi className={styles.time}>
      {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}
    </bdi>
  );
}

export default function ScheduleSettings({
  templates,
  requirements,
  sites,
  roles,
  days,
  onTemplate,
  onCoverage,
  onRestRules,
  onPermissions,
}: ScheduleSettingsProps) {
  const [day, setDay] = useState("");
  const [site, setSite] = useState("");
  const [role, setRole] = useState("");
  const filtered = Boolean(day || site || role);
  const visible = requirements
    .filter(
      (item) =>
        (!day || String(item.weekday) === day) &&
        (!site || item.site_id === site) &&
        (!role || item.role_id === role),
    )
    .sort(
      (left, right) =>
        Number(left.weekday) - Number(right.weekday) ||
        String(left.start_time).localeCompare(String(right.start_time)),
    );
  const siteNames = new Map(sites.map((item) => [item.id, String(item.name)]));
  const roleNames = new Map(roles.map((item) => [item.id, String(item.name)]));

  return (
    <section className={`panel ${styles.settings}`}>
      <div className={styles.settingsIntro}>
        <div>
          <h2>הגדרות סידור</h2>
          <p>כללי הארגון לשיבוץ משמרות. אין כאן קביעה של דרישות חוק.</p>
        </div>
        {(onRestRules || onPermissions) && (
          <div className={styles.settingsActions}>
            {onRestRules && (
              <button type="button" onClick={onRestRules}>
                <Clock3 size={16} aria-hidden />
                כללי מנוחה ושעות
              </button>
            )}
            {onPermissions && (
              <button type="button" onClick={onPermissions}>
                <ShieldCheck size={16} aria-hidden />
                הרשאות
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.settingsGroups}>
        <section className={styles.settingsGroup} aria-label="תבניות משמרת">
          <div className={styles.sectionHeader}>
            <h3>תבניות משמרת</h3>
            <button
              type="button"
              onClick={() => onTemplate()}
              aria-label="תבנית משמרת חדשה"
            >
              <Plus size={16} aria-hidden />
              <span className={styles.fullLabel}>תבנית משמרת חדשה</span>
              <span className={styles.shortLabel}>הוספה</span>
            </button>
          </div>
          {templates.length > 0 ? (
            <ul className={styles.settingsList}>
              {templates.map((item) => (
                <li key={item.id} className={styles.settingsItem}>
                  <div className={styles.settingsItemMain}>
                    <strong>{String(item.name)}</strong>
                    {item.confirmed ? (
                      <TimeRange item={item} />
                    ) : (
                      <small>שעות לא מאומתות — אין להשתמש לשיבוץ</small>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onTemplate(item)}
                    aria-label={`עריכת תבנית ${item.name}`}
                  >
                    עריכה
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>אין עדיין תבניות משמרת במחלקה</p>
          )}
        </section>

        <section className={styles.settingsGroup} aria-label="דרישות איוש">
          <div className={styles.sectionHeader}>
            <h3>
              דרישות איוש
              {requirements.length > 0 && (
                <span className="badge" role="status">
                  {filtered
                    ? `${visible.length} מתוך ${requirements.length}`
                    : requirements.length}
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => onCoverage()}
              aria-label="דרישת איוש חדשה"
            >
              <Plus size={16} aria-hidden />
              <span className={styles.fullLabel}>דרישת איוש חדשה</span>
              <span className={styles.shortLabel}>הוספה</span>
            </button>
          </div>
          {requirements.length > 0 && (
            <div
              className={styles.filterFields}
              role="group"
              aria-label="סינון דרישות איוש"
            >
              <label>
                יום
                <select
                  aria-label="סינון לפי יום"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                >
                  <option value="">הכול</option>
                  {days.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                מיקום
                <select
                  aria-label="סינון לפי מיקום"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                >
                  <option value="">הכול</option>
                  {sites.map((item) => (
                    <option key={item.id} value={item.id}>
                      {String(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                תפקיד
                <select
                  aria-label="סינון לפי תפקיד"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option value="">הכול</option>
                  {roles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {String(item.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {visible.length > 0 ? (
            <ul className={styles.settingsList}>
              {visible.map((item) => {
                const weekday = days[Number(item.weekday)];
                const required = Number(item.required_count);
                const siteName = siteNames.get(String(item.site_id));
                const roleName = roleNames.get(String(item.role_id));
                return (
                  <li className={styles.settingsItem} key={item.id}>
                    <div className={styles.settingsItemMain}>
                      <strong className={styles.requirementTitle}>
                        <CalendarDays size={15} aria-hidden />
                        <span>{weekday}</span>
                        <TimeRange item={item} />
                      </strong>
                      <small>
                        {[
                          siteName,
                          roleName,
                          required === 1 ? "עובד 1" : `${required} עובדים`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCoverage(item)}
                      aria-label={`עריכת דרישת איוש ליום ${weekday}${siteName ? ` · ${siteName}` : ""}`}
                    >
                      עריכה
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.empty}>
              {filtered
                ? "לא נמצאו דרישות איוש לפי הסינון שנבחר"
                : "אין עדיין דרישות איוש במחלקה"}
            </p>
          )}
          {filtered && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setDay("");
                setSite("");
                setRole("");
              }}
            >
              איפוס סינון
            </button>
          )}
        </section>
      </div>
      <p className={styles.integrationStatus}>
        מערכת סידורים חיצונית אינה מחוברת. ייבוא וייצוא ידניים זמינים בסידור
        העבודה.
      </p>
    </section>
  );
}
