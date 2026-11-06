import { beforeEach, expect, it, vi } from "vitest";
import {
  absenceEndDay,
  absenceInWeek,
  absenceInterval,
  absenceSchema,
  absencesForWeek,
  isWholeDayAbsence,
} from "../src/lib/absences";
import { demoCommand, loadDemo } from "../src/lib/demo";
import { canAssign } from "../src/lib/planner";
import { localDate } from "../src/lib/domain";
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
it("includes the end date and uses local calendar days across daylight saving changes", () => {
  const interval = absenceInterval("2026-03-27", "2026-03-27");
  expect(
    (Date.parse(interval.ends_at) - Date.parse(interval.starts_at)) / 3600000,
  ).toBe(23);
  const record = { id: "absence", kind: "leave", ...interval };
  expect(absenceEndDay(record)).toBe("2026-03-27");
  expect(isWholeDayAbsence(record)).toBe(true);
  expect(absenceInWeek(record, "2026-03-22")).toBe(true);
  expect(
    absenceInWeek(
      {
        id: "next-week",
        kind: "leave",
        ...absenceInterval("2026-11-08", "2026-11-08"),
      },
      "2026-11-01",
    ),
  ).toBe(false);
});
it("does not treat positive availability windows as absences and rejects invalid dates or types", () => {
  const window = {
    id: "available",
    kind: "available",
    ...absenceInterval("2026-11-06", "2026-11-06"),
  };
  expect(absencesForWeek([window], "2026-11-01")).toEqual([]);
  expect(
    absenceSchema.safeParse({
      employee_id: crypto.randomUUID(),
      starts_on: "2026-11-07",
      ends_on: "2026-11-06",
      absence_reason: "sick",
    }).success,
  ).toBe(false);
  expect(
    absenceSchema.safeParse({
      employee_id: crypto.randomUUID(),
      starts_on: "2026-11-06",
      ends_on: "2026-11-06",
      absence_reason: "available",
    }).success,
  ).toBe(false);
});
it("records and cancels sickness without changing recurring preferences or saved shifts", async () => {
  const data = loadDemo(),
    employee = data.employees[0];
  const shift = data.shift_assignments.find(
    (a) => a.employee_id === employee.id,
  )!;
  const pattern = Array.from({ length: 7 }, () => ["morning"]);
  await demoCommand("/api/admin", {
    kind: "employee",
    data: {
      id: employee.id,
      name: employee.name,
      active: true,
      user_id: null,
      weekly_availability: pattern,
    },
  });
  const shiftsBefore = JSON.stringify(loadDemo().shift_assignments);
  const day = localDate(shift.starts_at);
  await demoCommand("/api/admin", {
    kind: "absence",
    data: {
      employee_id: employee.id,
      absence_reason: "sick",
      starts_on: day,
      ends_on: day,
    },
  });
  const absent = loadDemo(),
    record = absent.availability.find((a) => a.employee_id === employee.id)!;
  expect(record).toMatchObject({ kind: "leave", absence_reason: "sick" });
  expect(canAssign(absent, shift, employee.id)).toBe(false);
  expect(JSON.stringify(absent.shift_assignments)).toBe(shiftsBefore);
  await demoCommand("/api/admin", {
    kind: "cancel_absence",
    data: { id: record.id },
  });
  const restored = loadDemo();
  expect(restored.availability).toHaveLength(0);
  expect(
    restored.employees.find((e) => e.id === employee.id)?.weekly_availability,
  ).toEqual(pattern);
  expect(canAssign(restored, shift, employee.id)).toBe(true);
});
