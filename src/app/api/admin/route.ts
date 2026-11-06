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
        ? await client.rpc("save_employee", { data })
        : kind === "initialize"
          ? await client.rpc("initialize_workspace", {
              site_name: data.site_name,
            })
          : await client.rpc("manage_entity", { kind, data });
    if (r.error)
      return NextResponse.json({ error: r.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e);
  }
}
