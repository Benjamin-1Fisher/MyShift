import { z } from "zod";
const id = { id: z.uuid().optional() };
const name = z.string().trim().min(1).max(100);
const base = { ...id, name };
export const adminSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initialize"),
    data: z.object({ site_name: name }),
  }),
  z.object({
    kind: z.literal("department"),
    data: z.object({
      ...base,
      active: z.boolean().optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
  }),
  z.object({ kind: z.literal("site"), data: z.object(base) }),
  z.object({
    kind: z.literal("role"),
    data: z.object({ ...base, department_id: z.uuid() }),
  }),
  z.object({
    kind: z.literal("employee"),
    data: z.object({
      ...base,
      active: z.boolean(),
      user_id: z.uuid().nullable(),
      department_id: z.uuid().optional(),
      role_id: z.uuid().optional(),
    }),
  }),
  z.object({
    kind: z.literal("membership"),
    data: z.object({
      employee_id: z.uuid(),
      department_id: z.uuid(),
      role_id: z.uuid(),
    }),
  }),
  z.object({
    kind: z.literal("template"),
    data: z.object({
      ...base,
      department_id: z.uuid(),
      start_time: z.string().nullable(),
      end_time: z.string().nullable(),
      confirmed: z.boolean(),
    }),
  }),
  z.object({
    kind: z.literal("availability"),
    data: z.object({
      ...id,
      employee_id: z.uuid(),
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      kind: z.enum(["available", "unavailable", "leave"]),
    }),
  }),
  z.object({
    kind: z.literal("coverage"),
    data: z.object({
      ...id,
      department_id: z.uuid(),
      site_id: z.uuid(),
      role_id: z.uuid(),
      weekday: z.number().int().min(0).max(6),
      start_time: z.string(),
      end_time: z.string(),
      required_count: z.number().int().min(1).max(100),
    }),
  }),
  z.object({
    kind: z.literal("settings"),
    data: z.object({
      min_rest_hours: z.number().min(0).max(168),
      max_shift_hours: z.number().positive().max(24),
    }),
  }),
  z.object({
    kind: z.literal("permission"),
    data: z.object({
      user_id: z.uuid(),
      role: z.enum(["admin", "manager", "employee"]),
      department_ids: z.array(z.uuid()),
    }),
  }),
  z.object({
    kind: z.literal("notification"),
    data: z.object({ id: z.uuid() }),
  }),
]);
