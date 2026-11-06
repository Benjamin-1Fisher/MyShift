import { beforeEach, expect, it, vi } from "vitest";
import { demoCommand, loadDemo, DEMO_KEY } from "../src/lib/demo";
import { scheduleNotices } from "../src/lib/schedule-notifications";
import type { Data } from "../src/lib/domain";
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
function context(data = loadDemo()) {
  const version = data.schedule_versions.find((v) => v.status === "draft")!;
  return {
    version,
    week: version.week_start,
    department_id: version.department_id,
  };
}
async function change(data: Data) {
  const version = data.schedule_versions.find((v) => v.status === "draft")!;
  const shift = data.shift_assignments.find(
    (a) => a.version_id === version.id,
  )!;
  const preview = (await demoCommand("/api/change", {
    action: "preview",
    version: version.id,
    operations: [{ ...shift, kind: "update", employee_id: null }],
  })) as { id: string };
  await demoCommand("/api/change", { action: "confirm", id: preview.id });
}
it("ignores welcome messages and draft edits and emits dated publication notices only once", async () => {
  const initial = loadDemo();
  expect(scheduleNotices(initial.notifications)).toEqual([]);
  await change(initial);
  expect(scheduleNotices(loadDemo().notifications)).toEqual([]);
  const { week, department_id } = context();
  await demoCommand("/api/change", { action: "publish", week, department_id });
  const first = scheduleNotices(loadDemo().notifications);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    kind: "schedule_published",
    week_start: week,
    department_id,
    details: { total_count: 7, open_count: 1 },
  });
  expect(Number.isFinite(Date.parse(first[0].created_at))).toBe(true);
  await demoCommand("/api/change", { action: "publish", week, department_id });
  expect(scheduleNotices(loadDemo().notifications)).toEqual(first);
});

it("distinguishes changes to published schedules from draft edits and includes exact change counts", async () => {
  const { week, department_id } = context();
  await demoCommand("/api/change", { action: "publish", week, department_id });
  await demoCommand("/api/change", { action: "reopen", week, department_id });
  expect(scheduleNotices(loadDemo().notifications)).toHaveLength(2);
  expect(
    scheduleNotices(loadDemo().notifications).some(
      (n) => n.kind === "schedule_withdrawn" && n.details.reason === "reopened",
    ),
  ).toBe(true);
  await change(loadDemo());
  expect(scheduleNotices(loadDemo().notifications)).toHaveLength(2);
  await demoCommand("/api/change", { action: "publish", week, department_id });
  const notice = scheduleNotices(loadDemo().notifications).find(
    (n) => n.kind === "schedule_changed",
  )!;
  expect(notice.details).toMatchObject({
    added: 0,
    removed: 0,
    updated: 1,
    total_count: 7,
  });
  expect(JSON.stringify(notice.details)).not.toContain("employee_id");
  await demoCommand("/api/admin", {
    kind: "notification",
    data: { id: notice.id },
  });
  expect(
    scheduleNotices(loadDemo().notifications).find((n) => n.id === notice.id)
      ?.read,
  ).toBe(true);
});

it("republishing without content changes is a normal publication, not a change alert", async () => {
  const { week, department_id } = context();
  for (const action of ["publish", "reopen", "publish"])
    await demoCommand("/api/change", { action, week, department_id });
  const notices = scheduleNotices(loadDemo().notifications);
  expect(notices.filter((n) => n.kind === "schedule_published")).toHaveLength(
    2,
  );
  expect(notices.filter((n) => n.kind === "schedule_changed")).toHaveLength(0);
});

it("keeps an older real publication and its date while hiding unrelated historical messages", async () => {
  const data = loadDemo(),
    { version } = context(data);
  version.status = "published";
  data.audit_logs.push({
    id: "old-audit",
    action: "פרסום סידור מקומי",
    after_data: { ...version },
    created_at: "2026-11-02T10:30:00Z",
  });
  const before = JSON.stringify(data.shift_assignments);
  storage.set(
    DEMO_KEY,
    JSON.stringify({ schema: 1, data, pending: [], departmentsUpgraded: true }),
  );
  const upgraded = loadDemo();
  const notices = scheduleNotices(upgraded.notifications);
  expect(notices).toHaveLength(1);
  expect(notices[0].created_at).toBe("2026-11-02T10:30:00Z");
  expect(notices[0].read).toBe(true);
  expect(JSON.stringify(upgraded.shift_assignments)).toBe(before);
  expect(scheduleNotices(loadDemo().notifications)).toEqual(notices);
});
