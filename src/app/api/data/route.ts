import { NextResponse } from "next/server";
import { session, loadData, safeError } from "@/lib/server";
export async function GET() {
  try {
    const { client, user } = await session();
    const [data, personal] = await Promise.all([
      loadData(client),
      client.rpc("read_personal_schedule"),
    ]);
    if (personal.error && personal.error.code !== "PGRST202")
      throw new Error(personal.error.message);
    let personalSchedule = personal.data;
    if (!personalSchedule) {
      const employeeId = data.employees.find(
        (employee) => employee.user_id === user.id,
      )?.id;
      const departmentIds = new Set(
        data.employee_departments
          .filter((membership) => membership.employee_id === employeeId)
          .map((membership) => membership.department_id),
      );
      const published = data.schedule_versions.filter(
        (version) =>
          version.status === "published" &&
          departmentIds.has(version.department_id),
      );
      const versions = new Set(published.map((version) => version.id));
      personalSchedule = {
        schedule_versions: published,
        shift_assignments: data.shift_assignments.filter(
          (shift) =>
            shift.employee_id === employeeId && versions.has(shift.version_id),
        ),
      };
    }
    return NextResponse.json(
      { data, personal: personalSchedule, userId: user.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return safeError(e);
  }
}
