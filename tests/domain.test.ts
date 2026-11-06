import { describe, it, expect } from "vitest";
import {
  interval,
  duration,
  overlaps,
  sunday,
  civilTime,
} from "../src/lib/domain";
describe("Jerusalem shifts", () => {
  it("counts overnight shift across calendar days", () => {
    const a = interval("2026-11-06", "23:00", "07:00");
    expect(duration(a)).toBe(8);
    expect(a.ends_at.slice(0, 10)).toBe("2026-11-07");
  });
  it("detects overlap regardless of department and allows adjacent shifts", () => {
    const a = interval("2026-11-06", "23:00", "07:00");
    expect(overlaps(a, interval("2026-11-07", "06:00", "14:00"))).toBe(true);
    expect(overlaps(a, interval("2026-11-07", "07:00", "15:00"))).toBe(false);
  });
  it("starts week on Sunday", () =>
    expect(sunday(new Date("2026-11-06T12:00:00Z"))).toBe("2026-11-01"));
  it("rejects nonexistent DST time", () =>
    expect(() => civilTime("2026-03-27", "02:30")).toThrow());
});
