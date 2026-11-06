import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const worker = "10000000-0000-4000-8000-000000000003";
const unrelated = "10000000-0000-4000-8000-000000000004";
let department: string, role: string, site: string, employee: string;
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
  return rpc("department_schedule_action", ["2026-11-01", action, department]);
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

it("reports exact published changes and a separate withdrawal while intermediate draft edits stay silent", async () => {
  const version = await schedule("create");
  await save(version, operation());
  await schedule("publish");
  await schedule("reopen");
  expect(await rows("select * from notifications")).toHaveLength(2);
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
  expect(await rows("select * from notifications")).toHaveLength(2);
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
  ).toEqual([{ reason: "reopened" }]);
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
  expect(await rows("select * from notifications")).toHaveLength(2);
  expect(
    await rows("select * from notifications where kind='schedule_changed'"),
  ).toHaveLength(0);
});

it("archiving an unpublished draft is silent; archiving a published schedule is an exception", async () => {
  const draft = await schedule("create");
  await rpc("schedule_recover", [draft, "archive", 0, draft, 0]);
  expect(await rows("select * from notifications")).toHaveLength(0);
  const published = await schedule("create");
  await schedule("publish");
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
});
