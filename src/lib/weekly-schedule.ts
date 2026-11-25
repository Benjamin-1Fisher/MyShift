import { z } from "zod";
import { operationSchema, type Assignment, type Row } from "./domain";

const draftTarget = z.object({
  department_id: z.uuid(),
  version_id: z.uuid(),
  revision: z.number().int().nonnegative(),
});
const operations = z.array(operationSchema).min(1).max(100);

export const weeklyScheduleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply_weekly_plan"),
    week: z.iso.date(),
    targets: z
      .array(
        draftTarget.extend({
          version_id: z.uuid().nullable(),
          status: z.enum(["draft", "published"]).nullable(),
          operations,
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal("undo_weekly_plan"),
    week: z.iso.date(),
    targets: z
      .array(
        draftTarget.extend({
          operations,
          restore_published: z.boolean(),
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal("review_weekly_publication"),
    week: z.iso.date(),
  }),
  z.object({
    action: z.literal("publish_weekly_schedule"),
    week: z.iso.date(),
    targets: z.array(draftTarget).min(1),
  }),
]);

export type WeeklyScheduleRequest = z.infer<typeof weeklyScheduleSchema>;
export type UndoWeeklyPlan = Extract<
  WeeklyScheduleRequest,
  { action: "undo_weekly_plan" }
>;
export type PersonalSchedule = {
  schedule_versions: Row[];
  shift_assignments: Assignment[];
};
export type ScheduleChange = {
  before: Assignment | null;
  after: Assignment | null;
};
export type WeeklyPlanResult = z.infer<typeof draftTarget> & {
  changes: ScheduleChange[];
};
export type PublicationReview = z.infer<typeof draftTarget> & {
  first_publication: boolean;
  open_count: number;
  changes: ScheduleChange[];
  error: string | null;
};
