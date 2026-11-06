import { beforeEach, expect, it, vi } from "vitest";
import { seedDemo, loadDemo, demoCommand } from "../src/lib/demo";
import { addDays, interval, type Assignment } from "../src/lib/domain";
import { canAssign, planWeek } from "../src/lib/planner";
import {
  isWeeklyAvailable,
  normalizeWeeklyAvailability,
  unrestrictedWeek,
  weeklyAvailabilitySchema,
  weeklyAvailabilitySummary,
} from "../src/lib/weekly-availability";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
function fixture() {
  const data = seedDemo().data;
  data.shift_assignments = [];
  const employee = data.employees[0];
  const shift = (date: string, start = "23:00", end = "07:00"): Assignment => ({
    id: "candidate",
    version_id: data.schedule_versions[0].id,
    department_id: data.departments[0].id,
    site_id: data.sites[0].id,
    role_id: data.roles[0].id,
    employee_id: employee.id,
    ...interval(date, start, end),
  });
  return { data, employee, shift };
}

it("keeps existing employees unrestricted and rejects invalid or empty weekly patterns", () => {
  const { data, employee, shift } = fixture();
  expect(canAssign(data, shift("2026-11-06"), employee.id)).toBe(true);
  expect(normalizeWeeklyAvailability(unrestrictedWeek())).toBeNull();
  for (const invalid of [
    [],
    Array.from({ length: 7 }, () => []),
    Array.from({ length: 7 }, () => ["morning", "morning"]),
    Array.from({ length: 7 }, () => ["unknown"]),
  ])
    expect(weeklyAvailabilitySchema.safeParse(invalid).success).toBe(false);
});

it("allows morning only and keeps date-specific leave stricter than recurring availability", () => {
  const { data, employee, shift } = fixture();
  employee.weekly_availability = Array.from({ length: 7 }, () => ["morning"]);
  expect(
    canAssign(data, shift("2026-11-06", "07:00", "15:00"), employee.id),
  ).toBe(true);
  expect(
    canAssign(data, shift("2026-11-06", "15:00", "23:00"), employee.id),
  ).toBe(false);
  expect(canAssign(data, shift("2026-11-06"), employee.id)).toBe(false);
  data.availability.push({
    id: "leave",
    employee_id: employee.id,
    kind: "leave",
    ...interval("2026-11-06", "07:00", "15:00"),
  });
  expect(
    canAssign(data, shift("2026-11-06", "07:00", "15:00"), employee.id),
  ).toBe(false);
});

it("uses the starting weekday for Friday nights, recurring across later weeks", () => {
  const { data, employee, shift } = fixture();
  employee.weekly_availability = [[], [], [], [], [], ["night"], []];
  expect(canAssign(data, shift("2026-11-06"), employee.id)).toBe(true);
  expect(canAssign(data, shift("2026-11-13"), employee.id)).toBe(true);
  expect(canAssign(data, shift("2026-11-07"), employee.id)).toBe(false);
  expect(canAssign(data, shift("2026-11-05"), employee.id)).toBe(false);
  expect(
    canAssign(data, shift("2026-11-06", "07:00", "15:00"), employee.id),
  ).toBe(false);
  expect(weeklyAvailabilitySummary(employee.weekly_availability)).toBe(
    "שישי: לילה",
  );
});

it("honors configured overnight template hours and selected weekdays", () => {
  const { data, employee, shift } = fixture();
  employee.weekly_availability = [[], [], [], [], [], ["night"], []];
  const custom = shift("2026-11-06", "21:30", "04:30");
  expect(isWeeklyAvailable(data, custom, employee.id)).toBe(false);
  data.shift_templates.push({
    id: "custom-night",
    department_id: custom.department_id,
    name: "לילה מיוחד",
    start_time: "21:30",
    end_time: "04:30",
    confirmed: true,
  });
  expect(isWeeklyAvailable(data, custom, employee.id)).toBe(true);
  employee.weekly_availability = unrestrictedWeek().map((periods, day) =>
    day < 5 ? periods : [],
  );
  expect(
    isWeeklyAvailable(data, shift("2026-11-03", "15:00", "23:00"), employee.id),
  ).toBe(true);
  expect(isWeeklyAvailable(data, custom, employee.id)).toBe(false);
});

it("automatic planning creates the full week while assigning only a permitted Friday night", () => {
  const { data } = fixture();
  for (const employee of data.employees)
    employee.weekly_availability = [[], [], [], [], [], ["night"], []];
  const week = addDays(String(data.schedule_versions[0].week_start), 7);
  const operations = planWeek(data, week, "generate");
  expect(operations).toHaveLength(21);
  const staffed = operations.filter(
    (op) => op.kind === "create" && op.employee_id,
  );
  expect(staffed).toHaveLength(1);
  expect(staffed[0]).toMatchObject(
    interval(addDays(week, 5), "23:00", "07:00"),
  );
});

it("demo saves patterns with qualifications, preserves them during other edits, and can clear them", async () => {
  const data = loadDemo();
  const department = data.departments[0].id,
    role = data.roles[0].id;
  await demoCommand("/api/admin", {
    kind: "employee",
    data: {
      name: "בן זמינות",
      active: true,
      user_id: null,
      department_id: department,
      role_id: role,
      weekly_availability: [[], [], [], [], [], ["night"], []],
    },
  });
  const employee = loadDemo().employees.find((e) => e.name === "בן זמינות")!;
  expect(employee.weekly_availability).toEqual([
    [],
    [],
    [],
    [],
    [],
    ["night"],
    [],
  ]);
  await demoCommand("/api/admin", {
    kind: "employee",
    data: {
      id: employee.id,
      name: "בן זמינות מעודכן",
      active: true,
      user_id: null,
    },
  });
  expect(
    loadDemo().employees.find((e) => e.id === employee.id)?.weekly_availability,
  ).toEqual(employee.weekly_availability);
  await demoCommand("/api/admin", {
    kind: "employee",
    data: {
      id: employee.id,
      name: "בן זמינות מעודכן",
      active: true,
      user_id: null,
      weekly_availability: null,
    },
  });
  expect(
    loadDemo().employees.find((e) => e.id === employee.id)?.weekly_availability,
  ).toBeNull();
});
