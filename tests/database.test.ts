import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001",
  manager = "10000000-0000-4000-8000-000000000002",
  worker = "10000000-0000-4000-8000-000000000003";
let dep: string,
  dep2: string,
  site: string,
  role: string,
  role2: string,
  employee: string,
  version: string;
async function q<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function rpc(fn: string, params: unknown[]) {
  return (
    await q<{ r: unknown }>(
      `select ${fn}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as r`,
      params,
    )
  )[0].r;
}
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('app.uid',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const op = (overrides = {}) => ({
  kind: "create",
  department_id: dep,
  site_id: site,
  role_id: role,
  employee_id: employee,
  starts_at: "2026-11-01T21:00:00Z",
  ends_at: "2026-11-02T05:00:00Z",
  ...overrides,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(readFileSync("supabase/migrations/001_myshift.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/002_ai_rate_limit.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/003_simple_onboarding.sql", "utf8"),
  );
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    manager,
    worker,
  ]);
  await db.query(
    "update profiles set role=case when id=$1 then 'admin'::app_role when id=$2 then 'manager'::app_role else 'employee'::app_role end",
    [admin, manager],
  );
  dep = (
    await q<{ id: string }>(
      "insert into departments(name) values('מחלקת דמו א') returning id",
    )
  )[0].id;
  dep2 = (
    await q<{ id: string }>(
      "insert into departments(name) values('מחלקת דמו ב') returning id",
    )
  )[0].id;
  site = (
    await q<{ id: string }>(
      "insert into sites(name) values('אתר דמו') returning id",
    )
  )[0].id;
  role = (
    await q<{ id: string }>(
      "insert into roles(name,department_id) values('סייר דמו',$1) returning id",
      [dep],
    )
  )[0].id;
  role2 = (
    await q<{ id: string }>(
      "insert into roles(name,department_id) values('סייר דמו',$1) returning id",
      [dep2],
    )
  )[0].id;
  employee = (
    await q<{ id: string }>(
      "insert into employees(name,user_id) values('עובד בדיקה פיקטיבי',$1) returning id",
      [worker],
    )
  )[0].id;
  await db.query(
    "insert into employee_departments values($1,$2,$3),($1,$4,$5)",
    [employee, dep, role, dep2, role2],
  );
  await db.query("insert into manager_departments values($1,$2)", [
    manager,
    dep,
  ]);
  await asUser(admin);
  version = (await rpc("schedule_action", ["2026-11-01", "create"])) as string;
}, 30000);
afterAll(async () => {
  await db.close();
});
it("preview rolls back assignment and audit; confirm commits once", async () => {
  await asUser(admin);
  const r = (await rpc("preview_change", [
    version,
    JSON.stringify([op()]),
  ])) as { id: string };
  expect(await q("select * from shift_assignments")).toHaveLength(0);
  expect(await q("select * from audit_logs")).toHaveLength(0);
  await rpc("confirm_change", [r.id]);
  expect(await q("select * from shift_assignments")).toHaveLength(1);
  expect(await q("select * from audit_logs")).toHaveLength(1);
  await expect(rpc("confirm_change", [r.id])).rejects.toThrow();
});
it("rejects overnight overlap across departments atomically", async () => {
  await expect(
    rpc("preview_change", [
      version,
      JSON.stringify([
        op({
          department_id: dep2,
          role_id: role2,
          starts_at: "2026-11-02T04:00:00Z",
          ends_at: "2026-11-02T12:00:00Z",
        }),
      ]),
    ]),
  ).rejects.toThrow(/חפיפה/);
  expect(await q("select * from shift_assignments")).toHaveLength(1);
});
it("cancellation prevents execution", async () => {
  const r = (await rpc("preview_change", [
    version,
    JSON.stringify([op({ employee_id: null })]),
  ])) as { id: string };
  await rpc("cancel_change", [r.id]);
  await expect(rpc("confirm_change", [r.id])).rejects.toThrow();
  expect(await q("select * from shift_assignments")).toHaveLength(1);
});
it("stale proposals are rejected", async () => {
  const a = (await rpc("preview_change", [
    version,
    JSON.stringify([op({ employee_id: null })]),
  ])) as { id: string };
  const b = (await rpc("preview_change", [
    version,
    JSON.stringify([op({ employee_id: null })]),
  ])) as { id: string };
  await rpc("confirm_change", [a.id]);
  await expect(rpc("confirm_change", [b.id])).rejects.toThrow(/הסידור השתנה/);
});
it("manager cannot write outside department or change privileges", async () => {
  await asUser(manager);
  await expect(
    rpc("preview_change", [
      version,
      JSON.stringify([
        op({ department_id: dep2, role_id: role2, employee_id: null }),
      ]),
    ]),
  ).rejects.toThrow(/הרשאה/);
  await expect(
    rpc("manage_entity", [
      "permission",
      JSON.stringify({ user_id: manager, role: "admin" }),
    ]),
  ).rejects.toThrow();
  await expect(
    db.query("insert into departments(name) values('forbidden')"),
  ).rejects.toThrow();
});
it("multi-operation validation failures roll back every row", async () => {
  await asUser(admin);
  const before = await q("select * from shift_assignments");
  await expect(
    rpc("preview_change", [
      version,
      JSON.stringify([
        op({ employee_id: null }),
        op({ department_id: dep2, role_id: role, employee_id: null }),
      ]),
    ]),
  ).rejects.toThrow(/תפקיד/);
  expect(await q("select * from shift_assignments")).toEqual(before);
});
it("availability blocks assignment and cancellation cannot be stolen", async () => {
  await asUser(admin);
  await rpc("manage_entity", [
    "availability",
    JSON.stringify({
      employee_id: employee,
      starts_at: "2026-11-03T00:00:00Z",
      ends_at: "2026-11-04T00:00:00Z",
      kind: "leave",
    }),
  ]);
  await expect(
    rpc("preview_change", [
      version,
      JSON.stringify([
        op({
          starts_at: "2026-11-03T05:00:00Z",
          ends_at: "2026-11-03T13:00:00Z",
        }),
      ]),
    ]),
  ).rejects.toThrow(/זמין/);
  const r = (await rpc("preview_change", [
    version,
    JSON.stringify([op({ employee_id: null })]),
  ])) as { id: string };
  await asUser(manager);
  await expect(rpc("confirm_change", [r.id])).rejects.toThrow();
  await asUser(admin);
  await rpc("cancel_change", [r.id]);
});
it("AI budget is enforced per authenticated identity", async () => {
  await asUser(manager);
  for (let i = 0; i < 10; i++) await rpc("claim_ai_slot", []);
  await expect(rpc("claim_ai_slot", [])).rejects.toThrow(/מגבלת/);
  await asUser(worker);
  await expect(rpc("claim_ai_slot", [])).rejects.toThrow(/הרשאה/);
});
it("employee sees only own published shifts, never writes", async () => {
  await asUser(worker);
  expect(await q("select * from shift_assignments")).toHaveLength(0);
  await expect(
    rpc("preview_change", [
      version,
      JSON.stringify([op({ employee_id: null })]),
    ]),
  ).rejects.toThrow(/הרשאה/);
  await asUser(admin);
  await rpc("schedule_action", ["2026-11-01", "publish"]);
  await asUser(worker);
  expect(await q("select * from shift_assignments")).toHaveLength(1);
});

it("null payloads cannot bypass mutation validation", async () => {
  await asUser(admin);
  await rpc("schedule_action", ["2026-11-01", "reopen"]);
  await expect(rpc("preview_change", [version, null])).rejects.toThrow(/1–100/);
  await asUser(worker);
  await expect(rpc("preview_change", [version, null])).rejects.toThrow(/הרשאה/);
});

it("creates employee and qualification atomically; rejects mismatched role without partial data", async () => {
  await asUser(admin);
  const id = await rpc("save_employee", [
    JSON.stringify({
      name: "עובד חדש לבדיקה",
      active: true,
      user_id: null,
      department_id: dep,
      role_id: role,
    }),
  ]);
  expect(
    await q("select * from employee_departments where employee_id=$1", [id]),
  ).toHaveLength(1);
  await expect(
    rpc("save_employee", [
      JSON.stringify({
        name: "לא אמור להישמר",
        active: true,
        user_id: null,
        department_id: dep,
        role_id: role2,
      }),
    ]),
  ).rejects.toThrow(/תפקיד/);
  expect(
    await q("select * from employees where name='לא אמור להישמר'"),
  ).toHaveLength(0);
  await asUser(manager);
  await expect(
    rpc("save_employee", [
      JSON.stringify({ name: "אסור", department_id: dep, role_id: role }),
    ]),
  ).rejects.toThrow(/הרשאת/);
});
it("initial organization setup is repeatable and admin-only", async () => {
  await asUser(admin);
  await rpc("initialize_workspace", ["אתר בדיקה חדש"]);
  await rpc("initialize_workspace", ["אתר בדיקה חדש"]);
  expect(
    await q("select * from sites where name='אתר בדיקה חדש'"),
  ).toHaveLength(1);
  await asUser(worker);
  await expect(rpc("initialize_workspace", ["אתר אסור"])).rejects.toThrow(
    /הרשאת/,
  );
});
