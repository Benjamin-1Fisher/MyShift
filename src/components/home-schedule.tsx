"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import styles from "./home-schedule.module.css";

const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const shortDays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const areas = [
  {
    name: "אחמ״שים",
    accent: "supervisors",
    staff: ["דניאל לוי", "נועה כהן", "איתי מזרחי"],
    hours: ["07:00–15:00", "15:00–23:00"],
  },
  {
    name: "סיירים",
    accent: "patrol",
    staff: ["מאיה ישראלי", "עומר ברק", "שירה רון"],
    hours: ["07:00–15:00", "15:00–23:00"],
  },
  {
    name: "קבלה",
    accent: "reception",
    staff: ["יעל הדר", "רוני פרץ", "עמית שלו"],
    hours: ["08:00–14:00", "14:00–20:00"],
  },
  {
    name: "חניונים",
    accent: "parking",
    staff: ["תמר גולן", "יובל רז", "גל ארז"],
    hours: ["06:00–14:00", "14:00–22:00"],
  },
];

export default function HomeSchedule() {
  const [selectedDay, setSelectedDay] = useState(0);

  return (
    <section className={styles.board} aria-labelledby="home-schedule-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <CalendarDays aria-hidden="true" size={23} />
          <h2 id="home-schedule-title">סידור משמרות שבועי</h2>
        </div>
        <span className={styles.sample}>נתונים לדוגמה</span>
      </header>

      <div className={styles.days} role="group" aria-label="בחירת יום">
        {days.map((day, index) => (
          <button
            key={day}
            type="button"
            aria-label={day}
            aria-pressed={selectedDay === index}
            onClick={() => setSelectedDay(index)}
          >
            {shortDays[index]}
          </button>
        ))}
      </div>

      <table className={styles.table} aria-labelledby="home-schedule-title">
        <thead>
          <tr>
            <th scope="col">אזור</th>
            {days.map((day, index) => (
              <th key={day} scope="col" data-selected={selectedDay === index}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr key={area.name} className={styles[area.accent]}>
              <th scope="row">{area.name}</th>
              {days.map((day, dayIndex) => (
                <td key={day} data-selected={selectedDay === dayIndex}>
                  <ul className={styles.shifts}>
                    {area.hours.map((hours, shiftIndex) => (
                      <li key={hours}>
                        <bdi dir="ltr">{hours}</bdi>
                        <strong>
                          {
                            area.staff[
                              (dayIndex + shiftIndex) % area.staff.length
                            ]
                          }
                        </strong>
                      </li>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
