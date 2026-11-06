import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { tables, type Data } from "./domain";
import { scheduleNoticeKinds } from "./schedule-notifications";
export async function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("CONFIG: יש להגדיר Supabase בקובץ .env.local");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) =>
        items.forEach(({ name, value, options }) =>
          jar.set(name, value, options),
        ),
    },
  });
}
export async function session() {
  const client = await db();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("AUTH: נדרשת התחברות");
  return { client, user };
}
export async function loadData(client: Awaited<ReturnType<typeof db>>) {
  const pairs = await Promise.all(
    tables.map(async (t) => {
      let q = client.from(t).select("*");
      if (t === "notifications")
        q = q
          .in("kind", [...scheduleNoticeKinds])
          .order("created_at", { ascending: false })
          .limit(200);
      else if (t === "audit_logs")
        q = q.order("created_at", { ascending: false }).limit(200);
      else if (t === "schedule_versions") q = q.order("id").limit(5000);
      else q = q.limit(5000);
      let { data, error } = await q;
      if (t === "notifications" && error?.code === "42703") {
        const legacy = await client
          .from(t)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        data = legacy.data;
        error = legacy.error;
      }
      if (error) throw new Error(error.message);
      if (!data) throw new Error("לא ניתן לטעון את הנתונים");
      if (data.length >= 5000)
        throw new Error(
          "Result capacity reached; add scoped pagination before loading more records",
        );
      return [t, data];
    }),
  );
  return Object.fromEntries(pairs) as Data;
}
export function safeError(error: unknown) {
  console.error(
    "MyShift request failed",
    error instanceof Error
      ? [error.name, ...(error.stack || "").split("\n").slice(1, 4)].join("\n")
      : "UnknownError",
  );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error:
          "בדוק את השדות המסומנים: " +
          error.issues
            .map((i) => i.path.join(".") + " — " + i.message)
            .join("; "),
      },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "הבקשה נכשלה";
  const known = message.startsWith("CONFIG:") || message.startsWith("AUTH:");
  return NextResponse.json(
    {
      error: known
        ? message
        : "הפעולה נכשלה. בדוק הרשאות, נתונים ורענן את הסידור.",
    },
    { status: message.startsWith("AUTH:") ? 401 : known ? 503 : 400 },
  );
}
export { assertSameOrigin as sameOrigin } from "./request-origin";
