"use client";
import { useId } from "react";
import {
  normalizeWeeklyAvailability,
  periodLabels,
  shiftPeriods,
  unrestrictedWeek,
  weekdayLabels,
  weeklyAvailabilitySummary,
  type ShiftPeriod,
  type WeeklyAvailability,
} from "@/lib/weekly-availability";

export default function WeeklyAvailabilityEditor({
  value,
  onChange,
  disabled,
}: {
  value: WeeklyAvailability;
  onChange: (value: WeeklyAvailability) => void;
  disabled: boolean;
}) {
  const hintId = useId();
  const days = value ?? unrestrictedWeek();
  const update = (next: ShiftPeriod[][]) =>
    onChange(normalizeWeeklyAvailability(next));
  const setDay = (day: number, periods: ShiftPeriod[]) =>
    update(days.map((old, index) => (index === day ? periods : old)));
  return (
    <details className="weekly-availability">
      <summary>
        <strong>זמינות קבועה למשמרות</strong>
        <span>{weeklyAvailabilitySummary(value)}</span>
      </summary>
      <p id={hintId}>
        בחרו ימים ומשמרות. הבחירה חוזרת בכל שבוע; לילה שייך ליום שבו הוא מתחיל.
      </p>
      <fieldset
        disabled={disabled}
        aria-label="בחירת זמינות קבועה"
        aria-describedby={hintId}
      >
        <div className="weekly-presets" aria-label="בחירה מהירה של זמינות">
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
          >
            הכול
          </button>
          {shiftPeriods.map((period) => (
            <button
              type="button"
              key={period}
              aria-pressed={days.every(
                (periods) => periods.length === 1 && periods[0] === period,
              )}
              onClick={() => update(Array.from({ length: 7 }, () => [period]))}
            >
              {periodLabels[period]} בלבד
            </button>
          ))}
          <button
            type="button"
            aria-pressed={
              days.slice(0, 5).every((periods) => periods.length > 0) &&
              days.slice(5).every((periods) => !periods.length)
            }
            onClick={() =>
              update(
                days.map((periods, day) =>
                  day < 5 ? (periods.length ? periods : [...shiftPeriods]) : [],
                ),
              )
            }
          >
            א׳–ה׳
          </button>
          <button
            type="button"
            onClick={() => update(Array.from({ length: 7 }, () => []))}
          >
            ניקוי בחירה
          </button>
        </div>
        <table className="weekly-availability-grid">
          <caption className="sr-only">זמינות קבועה לפי יום ומשמרת</caption>
          <thead>
            <tr>
              <th scope="col">יום</th>
              {shiftPeriods.map((period) => (
                <th scope="col" key={period}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${periodLabels[period]} בכל הימים`}
                      checked={days.every((periods) =>
                        periods.includes(period),
                      )}
                      onChange={(event) =>
                        update(
                          days.map((periods) =>
                            event.target.checked
                              ? [...new Set([...periods, period])]
                              : periods.filter((p) => p !== period),
                          ),
                        )
                      }
                    />
                    {periodLabels[period]}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdayLabels.map((day, index) => (
              <tr key={day}>
                <th scope="row">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`יום ${day}`}
                      checked={days[index].length > 0}
                      onChange={(event) =>
                        setDay(
                          index,
                          event.target.checked ? [...shiftPeriods] : [],
                        )
                      }
                    />
                    {day}
                  </label>
                </th>
                {shiftPeriods.map((period) => (
                  <td key={period}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`${periodLabels[period]} ביום ${day}`}
                        checked={days[index].includes(period)}
                        onChange={(event) =>
                          setDay(
                            index,
                            event.target.checked
                              ? [...days[index], period]
                              : days[index].filter((p) => p !== period),
                          )
                        }
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
    </details>
  );
}
