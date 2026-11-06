import { z } from "zod";
import type { Assignment, Data, Row } from "./domain";

export const scheduleNoticeKinds = [
  "schedule_published",
  "schedule_changed",
  "schedule_withdrawn",
] as const;
export const scheduleNoticeSchema = z.object({
  id: z.string(),
  kind: z.enum(scheduleNoticeKinds),
  version_id: z.string(),
  department_id: z.string(),
  week_start: z.iso.date(),
  created_at: z.iso.datetime({ offset: true }),
  read: z.boolean(),
  details: z.object({
    total_count: z.number().int().nonnegative(),
    open_count: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    reason: z.enum(["reopened", "archived"]).optional(),
  }),
});
export type ScheduleNotice = z.infer<typeof scheduleNoticeSchema>;
export type PublicationSnapshot = Omit<Assignment, "version_id">[];

export function scheduleSnapshot(
  data: Data,
  versionId: string,
): PublicationSnapshot {
  return data.shift_assignments
    .filter((a) => a.version_id === versionId)
    .map((a) => ({
      id: a.id,
      department_id: a.department_id,
      site_id: a.site_id,
      role_id: a.role_id,
      employee_id: a.employee_id,
      starts_at: new Date(a.starts_at).toISOString(),
      ends_at: new Date(a.ends_at).toISOString(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function publicationChanges(
  before: PublicationSnapshot,
  after: PublicationSnapshot,
) {
  const old = new Map(before.map((a) => [a.id, a]));
  const current = new Map(after.map((a) => [a.id, a]));
  return {
    total_count: after.length,
    open_count: after.filter((a) => !a.employee_id).length,
    added: after.filter((a) => !old.has(a.id)).length,
    removed: before.filter((a) => !current.has(a.id)).length,
    updated: after.filter(
      (a) =>
        old.has(a.id) && JSON.stringify(old.get(a.id)) !== JSON.stringify(a),
    ).length,
  };
}
export function scheduleNotices(rows: Row[]): ScheduleNotice[] {
  return rows
    .flatMap((row) => {
      const parsed = scheduleNoticeSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        b.id.localeCompare(a.id),
    );
}
export function noticeTitle(notice: ScheduleNotice) {
  return notice.kind === "schedule_published"
    ? "סידור פורסם"
    : notice.kind === "schedule_changed"
      ? "פורסם שינוי בסידור"
      : notice.details.reason === "archived"
        ? "סידור שפורסם הוסר"
        : "סידור שפורסם נפתח לעדכון";
}
