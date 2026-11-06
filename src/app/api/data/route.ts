import { NextResponse } from "next/server";
import { session, loadData, safeError } from "@/lib/server";
export async function GET() {
  try {
    const { client, user } = await session();
    return NextResponse.json(
      { data: await loadData(client), userId: user.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return safeError(e);
  }
}
