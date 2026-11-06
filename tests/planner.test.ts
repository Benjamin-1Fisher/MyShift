import { it, expect } from "vitest";
import { seedDemo } from "../src/lib/demo";
import { canAssign, planWeek, copyPreviousWeek } from "../src/lib/planner";
import { addDays, type Assignment } from "../src/lib/domain";
it("builds an entire open week, preserves data and assigns only eligible workers", () => {
  const data = seedDemo().data,
    week = String(data.schedule_versions[0].week_start),
    next = addDays(week, 7),
    before = JSON.stringify(data);
  const open = planWeek(data, next, "open");
  expect(open).toHaveLength(21);
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
  expect(planWeek(data, week, "generate")).toEqual([]);
  const next = addDays(week, 7),
    ops = planWeek(data, next, "generate");
  expect(ops).toHaveLength(21);
  expect(ops.every((op) => op.kind === "create" && !op.employee_id)).toBe(true);
  data.schedule_versions.push({
    id: "new",
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
  expect(copyPreviousWeek(data, addDays(week, 7))).toHaveLength(21);
  expect(() => copyPreviousWeek(data, week)).toThrow(/ריק/);
  data.schedule_versions[0].status = "archived";
  expect(() => copyPreviousWeek(data, addDays(week, 7))).toThrow(/אין סידור/);
  expect(planWeek(data, week, "generate")).toHaveLength(21);
});
