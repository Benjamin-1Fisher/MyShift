import { it, expect } from "vitest";
import { seedDemo } from "../src/lib/demo";
import { canAssign, planWeek, copyPreviousWeek } from "../src/lib/planner";
import {
  addDays,
  interval,
  localDate,
  type Assignment,
} from "../src/lib/domain";
it("builds an entire open week, preserves data and assigns only eligible workers", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start),
    next = addDays(week, 7),
    before = JSON.stringify(data);
  const open = planWeek(data, next, "open");
  expect(open).toHaveLength(21);
  for (let day = 0; day < 7; day++) {
    const date = addDays(next, day);
    expect(
      open.filter(
        (op) => op.kind === "create" && localDate(op.starts_at) === date,
      ),
    ).toHaveLength(3);
    for (const [start, end] of [
      ["07:00", "15:00"],
      ["15:00", "23:00"],
      ["23:00", "07:00"],
    ])
      expect(open).toEqual(
        expect.arrayContaining([
          expect.objectContaining(interval(date, start, end)),
        ]),
      );
  }
  expect(
    open.every((op) => op.kind === "create" && op.employee_id === null),
  ).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
  const filled = planWeek(data, next, "generate");
  const all = data.shift_assignments.concat(
    filled.map(
      (op, i) =>
        ({ ...op, id: "generated" + i, version_id: "new" }) as Assignment,
    ),
  );
  for (const s of all.filter((a) => a.version_id === "new" && a.employee_id))
    expect(canAssign(data, s, s.employee_id!, all)).toBe(true);
  expect(filled.some((op) => op.kind === "create" && op.employee_id)).toBe(
    true,
  );
});
it("keeps unfillable slots open, and generation is idempotent", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start);
  data.employees = data.employees.map((e) => ({ ...e, active: false }));
  const missing = planWeek(data, week, "generate");
  expect(missing).toHaveLength(14);
  expect(missing.every((op) => op.kind === "create" && !op.employee_id)).toBe(
    true,
  );
  const next = addDays(week, 7),
    ops = planWeek(data, next, "generate");
  expect(ops).toHaveLength(21);
  expect(ops.every((op) => op.kind === "create" && !op.employee_id)).toBe(true);
  data.schedule_versions.push({
    id: "new",
    department_id: data.departments[0].id,
    week_start: next,
    status: "draft",
    revision: 0,
  });
  data.shift_assignments.push(
    ...ops.map(
      (op, i) => ({ ...op, id: "new" + i, version_id: "new" }) as Assignment,
    ),
  );
  expect(planWeek(data, next, "generate")).toEqual([]);
});
it("copy never overwrites an existing week or reads a discarded source", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start);
  expect(copyPreviousWeek(data, addDays(week, 7))).toHaveLength(7);
  expect(() => copyPreviousWeek(data, week)).toThrow(/ריק/);
  data.schedule_versions[0].status = "archived";
  expect(() => copyPreviousWeek(data, addDays(week, 7))).toThrow(/אין סידור/);
  expect(planWeek(data, week, "generate")).toHaveLength(21);
});

it("partial coverage increases a shift's staffing without omitting evening or night on other days", () => {
  const data = seedDemo().data;
  const first = data.coverage_requirements[0];
  data.coverage_requirements = [{ ...first, required_count: 3 }];
  const week = addDays(String(data.schedule_versions[0].week_start), 7);
  const operations = planWeek(data, week, "open");
  expect(operations).toHaveLength(23);
  expect(
    operations.filter(
      (op) =>
        op.kind === "create" &&
        op.starts_at === interval(week, "07:00", "15:00").starts_at,
    ),
  ).toHaveLength(3);
  expect(
    operations.filter(
      (op) =>
        op.kind === "create" && localDate(op.starts_at) === addDays(week, 6),
    ),
  ).toHaveLength(3);
});

it("builds a full week from confirmed templates when there are no coverage requirements", () => {
  const data = seedDemo().data;
  data.coverage_requirements = [];
  expect(
    planWeek(
      data,
      addDays(String(data.schedule_versions[0].week_start), 7),
      "open",
    ),
  ).toHaveLength(21);
});
