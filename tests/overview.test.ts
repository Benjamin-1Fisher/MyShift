import { expect, it } from "vitest";
import { seedDemo } from "../src/lib/demo";
import { addDays } from "../src/lib/domain";
import {
  buildDepartmentOverview,
  employeeWeekShifts,
} from "../src/lib/overview";

it("summarizes only the selected week and authorized active departments without changing data", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start);
  const before = JSON.stringify(data);
  const rows = buildDepartmentOverview(data, week, [data.departments[0]]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    total: 7,
    staffed: 7,
    open: 0,
    conflicts: 0,
    missing: 14,
    status: "draft",
  });
  expect(JSON.stringify(data)).toBe(before);
  expect(
    buildDepartmentOverview(data, week, [
      { ...data.departments[0], active: false },
    ]),
  ).toEqual([]);
});
it("distinguishes open assignments, coverage requirements and weeks that have not been created", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start);
  const rows = buildDepartmentOverview(data, week, data.departments);
  expect(rows[1]).toMatchObject({ total: 14, open: 1, shortage: 1 });
  expect(rows[2]).toMatchObject({
    total: 0,
    status: "missing",
    configured: false,
  });
  const future = buildDepartmentOverview(
    data,
    addDays(week, 7),
    data.departments,
  );
  expect(future[0]).toMatchObject({
    total: 0,
    status: "missing",
    configured: true,
    missing: 21,
  });
  data.schedule_versions[0].status = "archived";
  expect(
    buildDepartmentOverview(data, week, [data.departments[0]])[0],
  ).toMatchObject({ total: 0, status: "missing" });
});
it("detects recurring-availability conflicts and reports invalid configuration without crashing", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start);
  data.employees[0].weekly_availability = [[], [], [], [], [], ["night"], []];
  expect(
    buildDepartmentOverview(data, week, [data.departments[0]])[0].conflicts,
  ).toBe(3);
  data.settings[0].max_shift_hours = 4;
  expect(
    buildDepartmentOverview(data, week, [data.departments[0]])[0].issue,
  ).toContain("ארוכה מהמותר");
});
it("employees see only their own published shifts for the chosen week", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start),
    employee = data.employees[0].id;
  expect(employeeWeekShifts(data, week, employee, data.departments)).toEqual(
    [],
  );
  data.schedule_versions[0].status = "published";
  const shifts = employeeWeekShifts(data, week, employee, data.departments);
  expect(shifts).toHaveLength(3);
  expect(shifts.every((a) => a.employee_id === employee)).toBe(true);
  expect(employeeWeekShifts(data, week, undefined, data.departments)).toEqual(
    [],
  );
  expect(
    employeeWeekShifts(data, week, employee, [data.departments[1]]),
  ).toEqual([]);
});
