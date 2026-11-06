import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const worker = "10000000-0000-4000-8000-000000000003";
let department: string, role: string, site: string;
const fridayNight = [[], [], [], [], [], ["night"], []];
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
async function rpc<T = string>(name: string, params: unknown[]) {
  await db.exec("savepoint rpc_request");
  try {
    const result = (
      await rows<{ result: T }>(
        `select ${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) result`,
        params,
      )
    )[0].result;
    await db.exec("release savepoint rpc_request");
    return result;
  } catch (error) {
    await db.exec(
      "rollback to savepoint rpc_request; release savepoint rpc_request",
    );
    throw error;
  }
}
const employeeData = (extra = {}) => ({
  name: "עובד זמינות",
  active: true,
  user_id: null,
  department_id: department,
  role_id: role,
  ...extra,
});
const shift = (
  employee: string,
  start = "2026-11-06T21:00:00Z",
  end = "2026-11-07T05:00:00Z",
) => ({
  kind: "create",
  employee_id: employee,
  department_id: department,
  site_id: site,
  role_id: role,
  starts_at: start,
  ends_at: end,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    manager,
    worker,
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
      "insert into sites(name) values('אתר בדיקה') returning id",
    )
  )[0].id;
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

it("atomically saves employee, qualification, recurring preferences and audit; other edits retain preferences", async () => {
  const id = await rpc("save_employee_with_availability", [
    JSON.stringify(employeeData({ weekly_availability: fridayNight })),
  ]);
  expect(
    await rows("select weekly_availability from employees where id=$1", [id]),
  ).toEqual([{ weekly_availability: fridayNight }]);
  expect(
    await rows("select * from employee_departments where employee_id=$1", [id]),
  ).toHaveLength(1);
  expect(
    await rows("select * from audit_logs where entity_id=$1", [id]),
  ).toHaveLength(2);
  await rpc("save_employee", [
    JSON.stringify(employeeData({ id, name: "שם מעודכן" })),
  ]);
  expect(
    await rows("select weekly_availability from employees where id=$1", [id]),
  ).toEqual([{ weekly_availability: fridayNight }]);
  await rpc("save_employee_with_availability", [
    JSON.stringify(employeeData({ id, weekly_availability: null })),
  ]);
  expect(
    await rows("select weekly_availability from employees where id=$1", [id]),
  ).toEqual([{ weekly_availability: null }]);
});

it("rejects malformed preferences and insufficient privileges without partial employee writes", async () => {
  for (const weekly_availability of [
    [],
    Array.from({ length: 7 }, () => []),
    Array.from({ length: 7 }, () => ["morning", "morning"]),
    Array.from({ length: 7 }, () => ["other"]),
  ])
    await expect(
      rpc("save_employee_with_availability", [
        JSON.stringify(employeeData({ weekly_availability })),
      ]),
    ).rejects.toThrow(/זמינות/);
  expect(await rows("select * from employees")).toHaveLength(0);
  expect(await rows("select * from employee_departments")).toHaveLength(0);
  expect(await rows("select * from audit_logs")).toHaveLength(0);
  for (const user of [manager, worker]) {
    await asUser(user);
    await expect(
      rpc("save_employee_with_availability", [
        JSON.stringify(employeeData({ weekly_availability: fridayNight })),
      ]),
    ).rejects.toThrow(/הרשאת/);
  }
});

it("database preview and confirmation enforce Friday night using the local starting day in every week", async () => {
  const employee = await rpc("save_employee_with_availability", [
    JSON.stringify(employeeData({ weekly_availability: fridayNight })),
  ]);
  for (const [week, start, end] of [
    ["2026-11-01", "2026-11-06T21:00:00Z", "2026-11-07T05:00:00Z"],
    ["2026-11-08", "2026-11-13T21:00:00Z", "2026-11-14T05:00:00Z"],
  ]) {
    const version = await rpc("department_schedule_action", [
      week,
      "create",
      department,
    ]);
    const preview = await rpc<{ id: string }>("preview_change", [
      version,
      JSON.stringify([shift(employee, start, end)]),
    ]);
    await rpc("confirm_change", [preview.id]);
    await expect(
      rpc("preview_change", [
        version,
        JSON.stringify([
          shift(
            employee,
            start.replace("T21:", "T05:"),
            start.replace("T21:", "T13:"),
          ),
        ]),
      ]),
    ).rejects.toThrow(/זמינות הקבועה/);
  }
  expect(await rows("select * from shift_assignments")).toHaveLength(2);
});

it("revalidates preferences changed after preview so confirmation cannot bypass availability", async () => {
  const employee = await rpc("save_employee", [JSON.stringify(employeeData())]);
  const version = await rpc("department_schedule_action", [
    "2026-11-01",
    "create",
    department,
  ]);
  const preview = await rpc<{ id: string }>("preview_change", [
    version,
    JSON.stringify([
      shift(employee, "2026-11-06T05:00:00Z", "2026-11-06T13:00:00Z"),
    ]),
  ]);
  await rpc("save_employee_with_availability", [
    JSON.stringify(
      employeeData({ id: employee, weekly_availability: fridayNight }),
    ),
  ]);
  await expect(rpc("confirm_change", [preview.id])).rejects.toThrow(
    /זמינות הקבועה/,
  );
  expect(await rows("select * from shift_assignments")).toHaveLength(0);
});

it("named custom night templates work while date-specific leave still blocks them", async () => {
  const employee = await rpc("save_employee_with_availability", [
    JSON.stringify(employeeData({ weekly_availability: fridayNight })),
  ]);
  await rpc("manage_entity", [
    "template",
    JSON.stringify({
      department_id: department,
      name: "לילה מותאם",
      start_time: "21:30",
      end_time: "04:30",
      confirmed: true,
    }),
  ]);
  const version = await rpc("department_schedule_action", [
    "2026-11-01",
    "create",
    department,
  ]);
  const operation = shift(
    employee,
    "2026-11-06T19:30:00Z",
    "2026-11-07T02:30:00Z",
  );
  await rpc("preview_change", [version, JSON.stringify([operation])]);
  await rpc("manage_entity", [
    "availability",
    JSON.stringify({
      employee_id: employee,
      kind: "leave",
      starts_at: operation.starts_at,
      ends_at: operation.ends_at,
    }),
  ]);
  await expect(
    rpc("preview_change", [version, JSON.stringify([operation])]),
  ).rejects.toThrow(/אינו זמין/);
});

it("saves inclusive sick days, blocks staffing and can cancel without changing the recurring pattern", async () => {
  const employee = await rpc("save_employee_with_availability", [
    JSON.stringify(
      employeeData({ user_id: worker, weekly_availability: fridayNight }),
    ),
  ]);
  const absence = await rpc("save_absence", [
    JSON.stringify({
      employee_id: employee,
      absence_reason: "sick",
      starts_on: "2026-11-06",
      ends_on: "2026-11-06",
    }),
  ]);
  expect(
    await rows("select kind,absence_reason from availability where id=$1", [
      absence,
    ]),
  ).toEqual([{ kind: "leave", absence_reason: "sick" }]);
  const version = await rpc("department_schedule_action", [
    "2026-11-01",
    "create",
    department,
  ]);
  await expect(
    rpc("preview_change", [version, JSON.stringify([shift(employee)])]),
  ).rejects.toThrow(/אינו זמין/);
  await asUser(worker);
  await rpc("cancel_absence", [absence]);
  await asUser(admin);
  expect(
    await rows("select * from availability where id=$1", [absence]),
  ).toHaveLength(0);
  expect(
    await rows("select weekly_availability from employees where id=$1", [
      employee,
    ]),
  ).toEqual([{ weekly_availability: fridayNight }]);
  await rpc("preview_change", [version, JSON.stringify([shift(employee)])]);
  expect(
    await rows(
      "select * from audit_logs where entity='absence' and entity_id=$1",
      [absence],
    ),
  ).toHaveLength(2);
});

it("protects other employees and positive availability records from the absence actions", async () => {
  const own = await rpc("save_employee", [
    JSON.stringify(employeeData({ user_id: worker })),
  ]);
  const other = await rpc("save_employee", [
    JSON.stringify(employeeData({ name: "עובד אחר" })),
  ]);
  const absence = await rpc("save_absence", [
    JSON.stringify({
      employee_id: other,
      absence_reason: "vacation",
      starts_on: "2026-11-06",
      ends_on: "2026-11-07",
    }),
  ]);
  await asUser(worker);
  await expect(rpc("cancel_absence", [absence])).rejects.toThrow(/הרשאה/);
  await expect(
    rpc("save_absence", [
      JSON.stringify({
        employee_id: other,
        absence_reason: "sick",
        starts_on: "2026-11-06",
        ends_on: "2026-11-06",
      }),
    ]),
  ).rejects.toThrow(/הרשאה/);
  await rpc("save_absence", [
    JSON.stringify({
      employee_id: own,
      absence_reason: "personal",
      starts_on: "2026-11-06",
      ends_on: "2026-11-06",
    }),
  ]);
  await asUser(admin);
  await rpc("manage_entity", [
    "availability",
    JSON.stringify({
      employee_id: own,
      kind: "available",
      starts_at: "2026-11-13T00:00:00Z",
      ends_at: "2026-11-14T00:00:00Z",
    }),
  ]);
  const positive = (
    await rows<{ id: string }>(
      "select id from availability where kind='available'",
    )
  )[0].id;
  await expect(rpc("cancel_absence", [positive])).rejects.toThrow(/לא נמצא/);
  expect(
    await rows("select * from availability where id=$1", [positive]),
  ).toHaveLength(1);
});
