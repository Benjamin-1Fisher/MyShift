import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("upgrades a populated mixed database, retaining shifts and archived history", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const file of [
      "001_myshift",
      "002_ai_rate_limit",
      "003_simple_onboarding",
      "004_schedule_trash",
      "005_create_after_archive",
    ])
      await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
    const id = () => crypto.randomUUID();
    const admin = id(),
      a = id(),
      b = id(),
      site = id(),
      ra = id(),
      rb = id(),
      active = id(),
      archived = id();
    await db.query("insert into auth.users(id) values($1)", [admin]);
    await db.query(
      "insert into departments(id,name) values($1,'אחמ״שים'),($2,'סיירים')",
      [a, b],
    );
    await db.query("insert into sites(id,name) values($1,'אתר קיים')", [site]);
    await db.query(
      "insert into roles(id,department_id,name) values($1,$2,'א'),($3,$4,'ב')",
      [ra, a, rb, b],
    );
    await db.query(
      "insert into schedule_versions(id,week_start,created_by,status) values($1,'2026-11-01',$3,'draft'),($2,'2026-11-01',$3,'archived')",
      [active, archived, admin],
    );
    for (const v of [active, archived])
      for (const [dep, role] of [
        [a, ra],
        [b, rb],
      ])
        await db.query(
          "insert into shift_assignments(version_id,department_id,site_id,role_id,starts_at,ends_at) values($1,$2,$3,$4,'2026-11-01T06:00Z','2026-11-01T14:00Z')",
          [v, dep, site, role],
        );
    const before = (
      await db.query(
        "select id,department_id,site_id,role_id,starts_at,ends_at from shift_assignments order by id",
      )
    ).rows;
    await db.exec(
      readFileSync("supabase/migrations/006_department_schedules.sql", "utf8"),
    );
    expect(
      (
        await db.query(
          "select id,department_id,site_id,role_id,starts_at,ends_at from shift_assignments order by id",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select * from shift_assignments a join schedule_versions v on v.id=a.version_id where a.department_id<>v.department_id",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from schedule_versions where status='draft'"))
        .rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query(
          "select * from schedule_versions where status='archived'",
        )
      ).rows,
    ).toHaveLength(2);
    expect((await db.query("select * from departments")).rows).toHaveLength(4);
  } finally {
    await db.close();
  }
}, 30000);
