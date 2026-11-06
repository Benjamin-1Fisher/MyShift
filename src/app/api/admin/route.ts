import { NextResponse } from "next/server";
import { session, sameOrigin, safeError } from "@/lib/server";
import { adminSchema } from "@/lib/admin-schema";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { client } = await session();
    const { kind, data } = adminSchema.parse(await req.json());
    const r =
      kind === "employee"
        ? await client.rpc(
            "weekly_availability" in data
              ? "save_employee_with_availability"
              : "save_employee",
            { data },
          )
        : kind === "absence"
          ? await client.rpc("save_absence", { data })
          : kind === "cancel_absence"
            ? await client.rpc("cancel_absence", { aid: data.id })
            : kind === "initialize"
              ? await client.rpc("initialize_workspace", {
                  site_name: data.site_name,
                })
              : await client.rpc("manage_entity", { kind, data });
    if (r.error)
      return NextResponse.json(
        {
          error:
            r.error.code === "PGRST202" &&
            ["employee", "absence", "cancel_absence"].includes(kind)
              ? "שמירת הנתונים החדשים עדיין לא הופעלה במערכת הארגונית. השינוי לא נשמר; יש לפנות למנהל המערכת."
              : r.error.message,
        },
        { status: 400 },
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e);
  }
}
