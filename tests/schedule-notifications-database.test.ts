import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const worker = "10000000-0000-4000-8000-000000000003";
const unrelated = "10000000-0000-4000-8000-000000000004";
let department: string, role: string, site: string, employee: string;
let otherDepartment: string, otherRole: string;
const week = "2026-11-01";
async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows;
}
async function asUser(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('app.uid',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function request<T>(fn: () => Promise<T>) {
  await db.exec("savepoint request");
  try {
    const result = await fn();
    await db.exec("release savepoint request");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint request; release savepoint request");
    throw error;
  }
}
async function rpc<T = string>(name: string, params: unknown[]) {
  return request(
    async () =>
      (
        await rows<{ result: T }>(
          `select ${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          params,
        )
      )[0].result,
  );
}
async function schedule(action: string) {
  return rpc("department_schedule_action", [week, action, department]);
}
async function save(version: string, operation: object) {
  const preview = await rpc<{ id: string }>("preview_change", [
    version,
    JSON.stringify([operation]),
  ]);
  await rpc("confirm_change", [preview.id]);
}
const operation = () => ({
  kind: "create",
  department_id: department,
  role_id: role,
  site_id: site,
  employee_id: employee,
  starts_at: "2026-11-06T21:00:00Z",
  ends_at: "2026-11-07T05:00:00Z",
});
type Shift = ReturnType<typeof operation> & { id: string };
type BatchResult = {
  department_id: string;
  version_id: string;
  revision: number;
  changes: { before: Shift | null; after: Shift | null }[];
};
type PublicationReview = BatchResult & {
  first_publication: boolean;
  error: string | null;
};
const newDraft = (departmentId: string, operations: object[]) => ({
  department_id: departmentId,
  version_id: null,
  revision: 0,
  status: null,
  operations,
});
function apply(targets: object[]) {
  return rpc<BatchResult[]>("apply_weekly_plan", [
    week,
    JSON.stringify(targets),
  ]);
}
function review() {
  return rpc<PublicationReview[]>("review_weekly_publication", [week]);
}
function publish(targets: object[]) {
  return rpc("publish_weekly_schedule", [week, JSON.stringify(targets)]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    manager,
    worker,
    unrelated,
  ]);
  await db.query("update profiles set role='admin' where id=$1", [admin]);
  await db.query("update profiles set role='manager' where id=$1", [manager]);
  department = (
    await rows<{ id: string }>(
      "select id from departments where name='אחמ״שים'",
    )
  )[0].id;
  role = (
    await rows<{ id: string }>("select id from roles where department_id=$1", [
      department,
    ])
  )[0].id;
  [otherDepartment, otherRole] = (
    await rows<{ department_id: string; id: string }>(
      "select r.department_id, r.id from roles r join departments d on d.id=r.department_id where d.name='סיירים'",
    )
  ).map((r) => [r.department_id, r.id])[0];
  site = (
    await rows<{ id: string }>(
      "insert into sites(name) values('אתר התראות') returning id",
    )
  )[0].id;
  employee = (
    await rows<{ id: string }>(
      "insert into employees(name,user_id) values('עובד בדיקה',$1) returning id",
      [worker],
    )
  )[0].id;
  await db.query("insert into employee_departments values($1,$2,$3)", [
    employee,
    department,
    role,
  ]);
  await db.query("insert into employee_departments values($1,$2,$3)", [
    employee,
    otherDepartment,
    otherRole,
  ]);
  await db.query("insert into manager_departments values($1,$2)", [
    manager,
    department,
  ]);
}, 30000);
beforeEach(async () => {
  await db.exec("begin");
  await asUser(admin);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
afterAll(async () => {
  await db.close();
});

it("publishes dated notices to the relevant recipients, keeps draft edits silent and does not duplicate a publication", async () => {
  const version = await schedule("create");
  await save(version, operation());
  expect(await rows("select * from notifications")).toHaveLength(0);
  await schedule("publish");
  const notices = await rows<{
    kind: string;
    version_id: string;
    week_start: Date;
    details: object;
    created_at: Date;
  }>("select * from notifications");
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    kind: "schedule_published",
    version_id: version,
    details: { total_count: 1, open_count: 0 },
  });
  expect(Number.isFinite(new Date(notices[0].created_at).getTime())).toBe(true);
  expect(JSON.stringify(notices[0].details)).not.toContain(employee);
  await schedule("publish");
  expect(await rows("select * from notifications")).toHaveLength(1);
  for (const user of [manager, worker]) {
    await asUser(user);
    expect(await rows("select * from notifications")).toHaveLength(1);
  }
  await asUser(unrelated);
  expect(await rows("select * from notifications")).toHaveLength(0);
  await expect(
    request(() => rows("select * from schedule_publications")),
  ).rejects.toThrow(/permission denied/);
});

it("keeps the publication visible while the draft is edited and reports the exact published change", async () => {
  const version = await schedule("create");
  await save(version, operation());
  await schedule("publish");
  await schedule("reopen");
  expect(await rows("select * from notifications")).toHaveLength(1);
  const shift = (
    await rows<{ id: string }>(
      "select id from shift_assignments where version_id=$1",
      [version],
    )
  )[0];
  await save(version, {
    ...operation(),
    id: shift.id,
    kind: "update",
    employee_id: null,
  });
  expect(await rows("select * from notifications")).toHaveLength(1);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    schedule_versions: [{ id: version, status: "published" }],
    shift_assignments: [{ id: shift.id, employee_id: employee }],
  });
  await asUser(unrelated);
  expect(await rpc("read_personal_schedule", [])).toEqual({
    schedule_versions: [],
    shift_assignments: [],
  });
  await asUser(admin);
  await schedule("publish");
  expect(
    await rows(
      "select details from notifications where kind='schedule_changed'",
    ),
  ).toEqual([
    {
      details: {
        total_count: 1,
        open_count: 1,
        added: 0,
        removed: 0,
        updated: 1,
      },
    },
  ]);
  expect(
    await rows(
      "select details->>'reason' reason from notifications where kind='schedule_withdrawn'",
    ),
  ).toEqual([]);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    schedule_versions: [{ id: version, status: "published" }],
    shift_assignments: [],
  });
});

it("allows reopening to fix changed availability but a failed publication creates no false notice", async () => {
  const version = await schedule("create");
  await save(version, operation());
  await schedule("publish");
  await rpc("save_employee_with_availability", [
    JSON.stringify({
      id: employee,
      name: "עובד בדיקה",
      active: true,
      user_id: worker,
      weekly_availability: Array.from({ length: 7 }, () => ["morning"]),
    }),
  ]);
  await schedule("reopen");
  await expect(schedule("publish")).rejects.toThrow(/זמינות הקבועה/);
  expect(await rows("select * from notifications")).toHaveLength(1);
  expect(
    await rows("select * from notifications where kind='schedule_changed'"),
  ).toHaveLength(0);
});

it("archiving an unpublished draft is silent; archiving a published schedule is an exception", async () => {
  const draft = await schedule("create");
  await rpc("schedule_recover", [draft, "archive", 0, draft, 0]);
  expect(await rows("select * from notifications")).toHaveLength(0);
  const published = await schedule("create");
  await save(published, operation());
  await schedule("publish");
  await schedule("reopen");
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    shift_assignments: [{ version_id: published }],
  });
  await asUser(admin);
  const revision = (
    await rows<{ revision: number }>(
      "select revision from schedule_versions where id=$1",
      [published],
    )
  )[0].revision;
  await rpc("schedule_recover", [
    published,
    "archive",
    revision,
    published,
    revision,
  ]);
  expect(
    await rows(
      "select details->>'reason' reason from notifications where kind='schedule_withdrawn'",
    ),
  ).toEqual([{ reason: "archived" }]);
  await rpc("schedule_recover", [
    published,
    "restore",
    revision + 1,
    null,
    null,
  ]);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toEqual({
    schedule_versions: [],
    shift_assignments: [],
  });
});

it("applies and publishes a batch atomically and scopes its review to managed departments", async () => {
  const otherShift = {
    ...operation(),
    department_id: otherDepartment,
    role_id: otherRole,
  };
  const overlapping = [
    newDraft(department, [operation()]),
    newDraft(otherDepartment, [otherShift]),
  ];
  await asUser(manager);
  await expect(apply(overlapping)).rejects.toThrow(/הרשאה למחלקה/);
  await asUser(admin);
  await expect(apply(overlapping)).rejects.toThrow(/חפיפה/);
  expect(await rows("select * from schedule_versions")).toHaveLength(0);
  expect(await rows("select * from shift_assignments")).toHaveLength(0);

  const saved = await apply([
    newDraft(department, [operation()]),
    newDraft(otherDepartment, [
      {
        ...otherShift,
        starts_at: "2026-11-05T08:00:00Z",
        ends_at: "2026-11-05T16:00:00Z",
      },
    ]),
  ]);
  expect(saved).toHaveLength(2);
  expect(saved.map((target) => target.revision)).toEqual([1, 1]);
  expect(await rows("select * from notifications")).toHaveLength(0);
  await asUser(manager);
  expect(await review()).toEqual([
    expect.objectContaining({
      department_id: department,
      first_publication: true,
      error: null,
      changes: [
        {
          before: null,
          after: expect.objectContaining({ employee_id: employee }),
        },
      ],
    }),
  ]);
  await expect(publish(saved)).rejects.toThrow(/הרשאה למחלקה/);
  await asUser(worker);
  expect(await review()).toEqual([]);
  expect(await rpc("read_personal_schedule", [])).toEqual({
    schedule_versions: [],
    shift_assignments: [],
  });
  await asUser(admin);
  await expect(
    publish([saved[0], { ...saved[1], revision: 0 }]),
  ).rejects.toThrow(/הסידור השתנה/);
  expect(await rows("select status from schedule_versions")).toEqual([
    { status: "draft" },
    { status: "draft" },
  ]);
  expect(await rows("select * from notifications")).toHaveLength(0);
  await publish(saved);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    schedule_versions: [{ status: "published" }, { status: "published" }],
    shift_assignments: [{ employee_id: employee }, { employee_id: employee }],
  });
});

it("rejects publishing a moved assignment while the old assignment is still visible", async () => {
  const version = await schedule("create");
  await save(version, operation());
  await schedule("publish");
  const oldShift = await rows<{ id: string }>(
    "select id from shift_assignments where version_id=$1",
    [version],
  );
  await schedule("reopen");
  await save(version, { kind: "delete", id: oldShift[0].id });
  const [added] = await apply([
    newDraft(otherDepartment, [
      { ...operation(), department_id: otherDepartment, role_id: otherRole },
    ]),
  ]);
  const reviews = await review();
  expect(reviews).toHaveLength(2);
  expect(reviews.map((item) => item.error)).toEqual([null, null]);
  expect(reviews.find((item) => item.version_id === version)).toMatchObject({
    first_publication: false,
    changes: [{ before: { id: oldShift[0].id }, after: null }],
  });
  await expect(publish([added])).rejects.toThrow(/עדיין מוצג לעובדים/);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    shift_assignments: [{ id: oldShift[0].id }],
  });
  await asUser(admin);
  await publish(reviews);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    shift_assignments: [{ version_id: added.version_id }],
  });
});

it("fills open shifts only and can undo a weekly plan back to the visible publication", async () => {
  const version = await schedule("create");
  await save(version, operation());
  await save(version, {
    ...operation(),
    employee_id: null,
    starts_at: "2026-11-05T08:00:00Z",
    ends_at: "2026-11-05T16:00:00Z",
  });
  await schedule("publish");
  const assignments = await rows<Shift>(
    "select * from shift_assignments where version_id=$1 order by starts_at",
    [version],
  );
  const [open, assigned] = assignments;
  const target = {
    department_id: department,
    version_id: version,
    revision: 3,
    status: "published",
  };
  await expect(
    apply([{ ...target, operations: [{ ...assigned, kind: "update" }] }]),
  ).rejects.toThrow(/משמרות פנויות בלבד/);
  const [changed] = await apply([
    {
      ...target,
      operations: [{ ...open, kind: "update", employee_id: employee }],
    },
  ]);
  expect(changed.revision).toBe(4);
  expect(await rows("select status from schedule_versions")).toEqual([
    { status: "draft" },
  ]);
  await asUser(worker);
  expect(await rpc("read_personal_schedule", [])).toMatchObject({
    shift_assignments: [{ id: assigned.id }],
  });
  await asUser(admin);
  const undo = {
    ...changed,
    restore_published: true,
    operations: [{ ...open, kind: "update" }],
  };
  await expect(
    rpc("undo_weekly_plan", [week, JSON.stringify([{ ...undo, revision: 3 }])]),
  ).rejects.toThrow(/הסידור השתנה/);
  await rpc("undo_weekly_plan", [week, JSON.stringify([undo])]);
  expect(await rows("select status from schedule_versions")).toEqual([
    { status: "published" },
  ]);
  expect(
    await rows(
      "select * from shift_assignments where version_id=$1 order by starts_at",
      [version],
    ),
  ).toEqual(assignments);
  expect(await rows("select * from notifications")).toHaveLength(1);
});
