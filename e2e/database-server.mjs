// Test-only Supabase protocol fixture backed by the real PostgreSQL migrations.
// It replaces external Auth only; all reads/writes execute as authenticated with RLS.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
);
for (const f of readdirSync("supabase/migrations").sort())
  await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
const uid = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "admin@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};
await db.query("insert into auth.users(id) values($1)", [uid]);
await db.query(
  "update profiles set name='מנהל בדיקה',role='admin' where id=$1",
  [uid],
);
let queue = Promise.resolve();
const tables = new Set([
  "profiles",
  "departments",
  "sites",
  "roles",
  "employees",
  "employee_departments",
  "shift_templates",
  "settings",
  "schedule_versions",
  "shift_assignments",
  "availability",
  "coverage_requirements",
  "notifications",
  "audit_logs",
]);
const functions = {
  manage_entity: ["kind", "data"],
  save_employee: ["data"],
  initialize_workspace: ["site_name"],
  schedule_action: ["week", "action"],
  schedule_lifecycle: ["week", "action", "expected_revision"],
  preview_change: ["vid", "ops"],
  confirm_change: ["rid"],
  cancel_change: ["rid"],
};
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3002");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString();
  let body = {};
  try {
    if (text) body = JSON.parse(text);
  } catch {
    res.writeHead(400).end("{}");
    return;
  }
  const url = new URL(req.url, "http://localhost:4001");
  if (url.pathname === "/health") {
    res.end("{}");
    return;
  }
  if (url.pathname === "/auth/v1/token") {
    if (
      body.email !== "admin@example.test" ||
      body.password !== "test-password-only"
    ) {
      res
        .writeHead(400)
        .end(JSON.stringify({ message: "invalid credentials" }));
      return;
    }
    res.end(
      JSON.stringify({
        access_token: "test-session-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "test-refresh-token",
        user,
      }),
    );
    return;
  }
  if (url.pathname === "/auth/v1/user") {
    if (req.headers.authorization !== "Bearer test-session-token") {
      res.writeHead(401).end("{}");
      return;
    }
    res.end(JSON.stringify(user));
    return;
  }
  if (req.headers.authorization !== "Bearer test-session-token") {
    res.writeHead(401).end("{}");
    return;
  }
  const execute = async () => {
    await db.exec("reset role");
    await db.query("select set_config('app.uid',$1,false)", [uid]);
    await db.exec("set role authenticated");
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      const keys = functions[fn];
      if (!keys) throw new Error("unknown function");
      const params = keys.map((k) =>
        typeof body[k] === "object" ? JSON.stringify(body[k]) : body[k],
      );
      return (
        await db.query(
          `select ${fn}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as r`,
          params,
        )
      ).rows[0].r;
    }
    const table = url.pathname.split("/").pop();
    if (!tables.has(table)) throw new Error("unknown table");
    const rows = (await db.query(`select * from ${table}`)).rows;
    if (table === "schedule_versions")
      for (const row of rows)
        row.week_start =
          row.week_start instanceof Date
            ? row.week_start.toISOString().slice(0, 10)
            : String(row.week_start).slice(0, 10);
    return rows;
  };
  const task = queue.then(execute);
  queue = task.catch(() => {});
  try {
    res.end(JSON.stringify(await task));
  } catch (e) {
    res
      .writeHead(400)
      .end(JSON.stringify({ message: e.message, code: "P0001" }));
  }
}).listen(4001, "127.0.0.1", () =>
  console.log("PostgreSQL test fixture ready"),
);
