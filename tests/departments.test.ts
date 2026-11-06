import { beforeEach, expect, it, vi } from "vitest";
import {
  seedDemo,
  loadDemo,
  demoCommand,
  DEMO_KEY,
  upgradeDemo,
} from "../src/lib/demo";
import { canAssign, planWeek } from "../src/lib/planner";
import { addDays, type Assignment } from "../src/lib/domain";
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
});
it("adds four dynamic departments without inventing unknown hours", () => {
  const data = seedDemo().data;
  expect(data.departments.map((d) => d.name)).toEqual([
    "אחמ״שים",
    "סיירים",
    "קבלה",
    "חניונים",
  ]);
  for (const dep of data.departments.slice(2)) {
    expect(
      data.employees.filter((e) =>
        data.employee_departments.some(
          (m) => m.department_id === dep.id && m.employee_id === e.id,
        ),
      ),
    ).toHaveLength(2);
    expect(
      data.shift_templates
        .filter((t) => t.department_id === dep.id)
        .every((t) => !t.confirmed && !t.start_time && !t.end_time),
    ).toBe(true);
    expect(() =>
      planWeek(
        data,
        addDays(String(data.schedule_versions[0].week_start), 7),
        "open",
        dep.id,
      ),
    ).toThrow(/להגדיר/);
  }
});
it("splits legacy mixed schedules without dropping shifts, employees, archives or user edits", () => {
  const store = seedDemo();
  const first = store.data.schedule_versions[0],
    second = store.data.schedule_versions.find(
      (v) => v.department_id === store.data.departments[1].id,
    )!;
  for (const shift of store.data.shift_assignments)
    if (shift.version_id === second.id) shift.version_id = first.id;
  store.data.schedule_versions = store.data.schedule_versions.filter(
    (v) => v !== second,
  );
  delete first.department_id;
  delete store.departmentsUpgraded;
  first.status = "archived";
  store.data.employees[0].name = "שם שמור";
  const shifts = store.data.shift_assignments.map((a) => ({
    ...a,
    version_id: undefined,
  }));
  upgradeDemo(store);
  expect(
    store.data.shift_assignments.map((a) => ({ ...a, version_id: undefined })),
  ).toEqual(shifts);
  expect(store.data.employees[0].name).toBe("שם שמור");
  for (const a of store.data.shift_assignments)
    expect(
      store.data.schedule_versions.find((v) => v.id === a.version_id)
        ?.department_id,
    ).toBe(a.department_id);
  const snapshot = JSON.stringify(store);
  upgradeDemo(store);
  expect(JSON.stringify(store)).toBe(snapshot);
});
it("publishes, archives and restores only the selected department, retaining other shifts", async () => {
  const data = loadDemo(),
    dep = data.departments[0],
    other = data.departments[1],
    week = String(data.schedule_versions[0].week_start);
  await demoCommand("/api/change", {
    action: "publish",
    week,
    department_id: dep.id,
  });
  let saved = loadDemo();
  expect(
    saved.schedule_versions.find(
      (v) => v.week_start === week && v.department_id === dep.id,
    )?.status,
  ).toBe("published");
  const untouched = saved.schedule_versions.find(
    (v) => v.week_start === week && v.department_id === other.id,
  )!;
  expect(untouched.status).toBe("draft");
  const v = saved.schedule_versions.find(
    (v) => v.week_start === week && v.department_id === dep.id,
  )!;
  await demoCommand("/api/change", {
    action: "archive",
    week,
    department_id: dep.id,
    id: v.id,
    revision: v.revision,
    active_id: v.id,
    active_revision: v.revision,
  });
  saved = loadDemo();
  expect(saved.schedule_versions.find((r) => r.id === untouched.id)).toEqual(
    untouched,
  );
  expect(saved.shift_assignments).toEqual(data.shift_assignments);
  await demoCommand("/api/change", {
    action: "restore",
    week,
    department_id: dep.id,
    id: v.id,
    revision: Number(v.revision) + 1,
    active_id: null,
    active_revision: null,
  });
  expect(loadDemo().schedule_versions.find((r) => r.id === v.id)?.status).toBe(
    "draft",
  );
  expect(storage.has(DEMO_KEY)).toBe(true);
});
it("rejects unauthorized department shifts and global overlap for explicitly multi-qualified employees", async () => {
  const data = loadDemo(),
    version = data.schedule_versions[0],
    shift = data.shift_assignments.find((a) => a.version_id === version.id)!;
  const other = data.departments[1];
  await expect(
    demoCommand("/api/change", {
      action: "preview",
      version: version.id,
      operations: [
        {
          ...shift,
          kind: "create",
          department_id: other.id,
          role_id: data.roles.find((r) => r.department_id === other.id)!.id,
        },
      ],
    }),
  ).rejects.toThrow(/מחלקה/);
  const candidate = {
    ...shift,
    department_id: other.id,
    role_id: String(data.roles.find((r) => r.department_id === other.id)!.id),
    id: crypto.randomUUID(),
  } as Assignment;
  expect(canAssign(data, candidate, shift.employee_id!)).toBe(false);
  data.employee_departments.push({
    id: crypto.randomUUID(),
    employee_id: shift.employee_id,
    department_id: other.id,
    role_id: candidate.role_id,
  });
  expect(canAssign(data, candidate, shift.employee_id!)).toBe(false);
});

it("retains department renames and disablement on reload instead of reseeding them", async () => {
  const data = loadDemo(),
    dep = data.departments[0];
  await demoCommand("/api/admin", {
    kind: "department",
    data: {
      id: dep.id,
      name: "שם מחלקה מעודכן",
      color: "#123456",
      active: false,
    },
  });
  const saved = loadDemo();
  expect(saved.departments).toHaveLength(4);
  expect(saved.departments[0].name).toBe("שם מחלקה מעודכן");
  expect(saved.departments[0].active).toBe(false);
});

it("does not let a past availability submission block future weeks", () => {
  const data = seedDemo().data,
    base = data.shift_assignments[0];
  data.availability.push({
    id: crypto.randomUUID(),
    employee_id: base.employee_id,
    kind: "available",
    starts_at: base.starts_at,
    ends_at: base.ends_at,
  });
  const next = {
    ...base,
    id: crypto.randomUUID(),
    starts_at: new Date(
      Date.parse(base.starts_at) + 14 * 86400000,
    ).toISOString(),
    ends_at: new Date(Date.parse(base.ends_at) + 14 * 86400000).toISOString(),
  };
  expect(canAssign(data, next, base.employee_id!)).toBe(true);
});
