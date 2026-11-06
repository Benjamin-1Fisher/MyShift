import { NextResponse } from "next/server";
import { z } from "zod";
import { operationSchema } from "@/lib/domain";
import { session, safeError, sameOrigin } from "@/lib/server";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["archive", "restore"]),
    week: z.iso.date(),
    revision: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("preview"),
    version: z.uuid(),
    operations: z.array(operationSchema).min(1).max(100),
  }),
  z.object({ action: z.enum(["confirm", "cancel"]), id: z.uuid() }),
  z.object({
    action: z.enum(["create", "publish", "reopen"]),
    week: z.iso.date(),
  }),
]);
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { client } = await session();
    const input = schema.parse(await req.json());
    const result =
      input.action === "archive" || input.action === "restore"
        ? await client.rpc("schedule_lifecycle", {
            week: input.week,
            action: input.action,
            expected_revision: input.revision,
          })
        : input.action === "preview"
          ? await client.rpc("preview_change", {
              vid: input.version,
              ops: input.operations,
            })
          : "id" in input
            ? await client.rpc(
                input.action === "confirm" ? "confirm_change" : "cancel_change",
                { rid: input.id },
              )
            : await client.rpc("schedule_action", {
                week: input.week,
                action: input.action,
              });
    if (result.error)
      return NextResponse.json(
        {
          error:
            result.error.code === "PGRST202"
              ? "מחיקה ושחזור עדיין לא הופעלו במערכת הארגון. יש לפנות למנהל המערכת"
              : result.error.message,
        },
        { status: 400 },
      );
    return NextResponse.json(result.data);
  } catch (e) {
    return safeError(e);
  }
}
