import { describe, expect, it } from "vitest";
import {
  addDays,
  interval,
  tables,
  type Assignment,
  type Data,
} from "../src/lib/domain";
import { organizationWeek } from "../src/lib/organization-week";

describe("organization week", () => {
  it("includes only scoped active versions and buckets overnight work by Jerusalem start day", () => {
    const week = "2026-11-22";
    const departments = [{ id: "a" }, { id: "b" }, { id: "empty" }];
    const data = Object.fromEntries(
      tables.map((t) => [t, []]),
    ) as unknown as Data;
    data.schedule_versions = [
      { id: "a-draft", department_id: "a", week_start: week, status: "draft" },
      { id: "a-old", department_id: "a", week_start: week, status: "archived" },
      {
        id: "a-prev",
        department_id: "a",
        week_start: addDays(week, -7),
        status: "published",
      },
      {
        id: "b-live",
        department_id: "b",
        week_start: week,
        status: "published",
      },
      {
        id: "private",
        department_id: "private",
        week_start: week,
        status: "draft",
      },
    ];
    const shift = (
      id: string,
      dep: string,
      version: string,
      start: string,
      end: string,
      employee: string | null,
      day = week,
    ): Assignment => ({
      id,
      department_id: dep,
      version_id: version,
      employee_id: employee,
      role_id: "r",
      site_id: "s",
      ...interval(day, start, end),
    });
    data.shift_assignments = [
      shift("night", "a", "a-draft", "23:50", "06:00", null),
      shift("first", "a", "a-draft", "08:00", "16:00", "e"),
      shift("second-department", "b", "b-live", "11:00", "16:00", "f"),
      shift(
        "week-edge",
        "b",
        "b-live",
        "23:50",
        "06:00",
        "f",
        addDays(week, 6),
      ),
      shift("previous", "a", "a-prev", "09:00", "16:00", "e"),
      shift("archived", "a", "a-old", "09:00", "16:00", "e"),
      shift("out-of-scope", "private", "private", "09:00", "16:00", "e"),
      shift("wrong-department", "b", "a-draft", "09:00", "16:00", "e"),
      shift(
        "next-week",
        "b",
        "b-live",
        "09:00",
        "16:00",
        "e",
        addDays(week, 7),
      ),
    ];
    const board = organizationWeek(data, departments, week);
    expect(board.dates).toHaveLength(7);
    expect(board.rows.map((r) => r.status)).toEqual(["draft", "published", ""]);
    expect(board.rows[0].days[0].map((s) => s.id)).toEqual(["first", "night"]);
    expect(board.rows[0].days[1]).toEqual([]);
    expect(board.rows[1].days[6].map((s) => s.id)).toEqual(["week-edge"]);
    expect(board.total).toBe(4);
    expect(board.unassigned).toBe(1);
  });
});
