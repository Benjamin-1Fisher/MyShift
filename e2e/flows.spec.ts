import { test, expect } from "@playwright/test";
import type { Data } from "../src/lib/domain";
import {
  clickWeekAction,
  exact,
  navigation,
  openDepartment,
  openMain,
  planning,
} from "./workspace-controls";
test("organization: direct save, undo copied shift, publish, archive and restore", async ({
  page,
}) => {
  page.on("response", async (r) => {
    if (r.url().includes("/api/") && !r.ok())
      console.log("API error", r.url(), r.status(), await r.text());
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app");
  await page.getByLabel("דוא״ל").fill("admin@example.test");
  await page.getByLabel("סיסמה").fill("test-password-only");
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "הגדרה ראשונית של הארגון" }),
  ).toBeVisible();
  await page.getByLabel("שם האתר הראשון").fill("אתר בדיקה פיקטיבי");
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("button", { name: "הוספת עובד ראשון" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("שם העובד").fill("עובד בדיקה פיקטיבי");
  await form
    .getByRole("combobox", exact("מחלקה"))
    .selectOption({ label: "סיירים" });
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "סיירים" });
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "עובד בדיקה פיקטיבי" }),
  ).toBeVisible();
  await openDepartment(page, "סיירים");
  // No draft exists: saving first shift creates the draft and previews atomically scoped changes.
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  const shift = page.getByRole("dialog");
  const shiftDepartment = shift.getByRole("combobox", exact("מחלקה"));
  await expect(shiftDepartment).toBeDisabled();
  await expect(shiftDepartment.locator("option:checked")).toHaveText("סיירים");
  await shift
    .getByRole("combobox", exact("תפקיד"))
    .selectOption({ label: "סיירים" });
  await shift.getByLabel("התחלה", { exact: true }).fill("23:00");
  await shift.getByLabel("סיום", { exact: true }).fill("07:00");
  await shift
    .getByLabel("עובד במשמרת")
    .selectOption({ label: "עובד בדיקה פיקטיבי" });
  await shift.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("למחרת");
  await page.reload();
  await expect(planning(page)).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(1);
  await page.locator(".shift-main").click();
  await page.getByRole("button", { name: "שכפול משמרת", exact: true }).click();
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(2);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await clickWeekAction(page, "פרסום סידור");
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await clickWeekAction(page, "העברה לסל המחזור");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "העברה לסל המחזור", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.reload();
  await expect(
    planning(page).getByRole("button", exact("הגדרת שעות")),
  ).toBeVisible();
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("התחלה", { exact: true })
    .fill("08:00");
  await page
    .getByRole("dialog")
    .getByLabel("סיום", { exact: true })
    .fill("16:00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "שמירה", exact: true })
    .click();
  await expect(page.locator(".shift.open")).toHaveCount(1);
  await clickWeekAction(page, "שחזור סידור");
  await page.getByRole("button", { name: "אישור שחזור", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  await openMain(page, "הגדרות");
  await page.getByRole("button", { name: "יומן פעילות", exact: true }).click();
  await expect(page.locator("details.audit")).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test("organization saves weekly availability atomically and enforces it through the API", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByLabel("דוא״ל").fill("admin@example.test");
  await page.getByLabel("סיסמה").fill("test-password-only");
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(
    navigation(page).getByRole("button", exact("צוות")),
  ).toBeVisible();
  await navigation(page).getByRole("button", exact("צוות")).click();
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("שם תצוגה", { exact: true }).fill("עובד לילה בשישי");
  await form
    .getByRole("combobox", exact("מחלקה"))
    .selectOption({ label: "סיירים" });
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "סיירים" });
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "ניקוי בחירה", exact: true }).click();
  await form.getByLabel("לילה ביום שישי", { exact: true }).check();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.reload();
  await navigation(page).getByRole("button", exact("צוות")).click();
  await expect(
    page.getByRole("row").filter({ hasText: "עובד לילה בשישי" }),
  ).toContainText("שישי: לילה");
  const { data }: { data: Data } = await (
    await page.request.get("/api/data")
  ).json();
  const employee = data.employees.find((e) => e.name === "עובד לילה בשישי")!;
  expect(employee.weekly_availability).toEqual([
    [],
    [],
    [],
    [],
    [],
    ["night"],
    [],
  ]);
  const membership = data.employee_departments.find(
    (m) => m.employee_id === employee.id,
  )!;
  const headers = { Origin: "http://localhost:3002" };
  const created = await page.request.post("/api/change", {
    headers,
    data: {
      action: "create",
      week: "2026-11-08",
      department_id: membership.department_id,
    },
  });
  expect(created.ok()).toBe(true);
  const version = await created.json();
  const operation = {
    kind: "create",
    employee_id: employee.id,
    department_id: membership.department_id,
    role_id: membership.role_id,
    site_id: data.sites[0].id,
    starts_at: "2026-11-13T05:00:00Z",
    ends_at: "2026-11-13T13:00:00Z",
  };
  const blocked = await page.request.post("/api/change", {
    headers,
    data: { action: "preview", version, operations: [operation] },
  });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error).toContain("זמינות הקבועה");
  const allowed = await page.request.post("/api/change", {
    headers,
    data: {
      action: "preview",
      version,
      operations: [
        {
          ...operation,
          starts_at: "2026-11-13T21:00:00Z",
          ends_at: "2026-11-14T05:00:00Z",
        },
      ],
    },
  });
  expect(allowed.ok()).toBe(true);
  const preview = await allowed.json();
  expect(
    (
      await page.request.post("/api/change", {
        headers,
        data: { action: "confirm", id: preview.id },
      })
    ).ok(),
  ).toBe(true);
  const saved: { data: Data } = await (
    await page.request.get("/api/data")
  ).json();
  expect(
    saved.data.shift_assignments.filter((a) => a.employee_id === employee.id),
  ).toHaveLength(1);
  expect(
    (
      await page.request.post("/api/change", {
        headers,
        data: {
          action: "publish",
          week: "2026-11-08",
          department_id: membership.department_id,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^התראות/ })
    .click();
  const notice = page
    .getByRole("article", { name: "סידור פורסם", exact: true })
    .filter({ hasText: "08.11.2026" });
  await expect(notice).toHaveCount(1);
  await notice
    .getByRole("button", { name: "פירוט: סידור פורסם", exact: true })
    .click();
  await expect(notice.locator(".notice-details")).toContainText(
    "1 משמרות בסידור",
  );
  await expect(notice.getByText("חדש", { exact: true })).toHaveCount(0);
});

test("organization records and cancels sickness and the server enforces the blocked dates", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByLabel("דוא״ל").fill("admin@example.test");
  await page.getByLabel("סיסמה").fill("test-password-only");
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(
    navigation(page).getByRole("button", exact("צוות")),
  ).toBeVisible();
  const { data }: { data: Data } = await (
    await page.request.get("/api/data")
  ).json();
  const employee = data.employees.find((e) => e.name === "עובד לילה בשישי")!;
  const member = data.employee_departments.find(
    (m) => m.employee_id === employee.id,
  )!;
  const headers = { Origin: "http://localhost:3002" };
  expect(
    (
      await page.request.post("/api/admin", {
        headers,
        data: {
          kind: "absence",
          data: {
            employee_id: employee.id,
            absence_reason: "sick",
            starts_on: "2026-11-20",
            ends_on: "2026-11-20",
          },
        },
      })
    ).ok(),
  ).toBe(true);
  const absent: { data: Data } = await (
    await page.request.get("/api/data")
  ).json();
  const report = absent.data.availability.find(
    (a) => a.employee_id === employee.id && a.absence_reason === "sick",
  )!;
  expect(report.kind).toBe("leave");
  const version = await (
    await page.request.post("/api/change", {
      headers,
      data: {
        action: "create",
        week: "2026-11-15",
        department_id: member.department_id,
      },
    })
  ).json();
  const operation = {
    kind: "create",
    employee_id: employee.id,
    department_id: member.department_id,
    role_id: member.role_id,
    site_id: data.sites[0].id,
    starts_at: "2026-11-20T21:00:00Z",
    ends_at: "2026-11-21T05:00:00Z",
  };
  const blocked = await page.request.post("/api/change", {
    headers,
    data: { action: "preview", version, operations: [operation] },
  });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error).toContain("אינו זמין");
  expect(
    (
      await page.request.post("/api/admin", {
        headers,
        data: { kind: "cancel_absence", data: { id: report.id } },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/change", {
        headers,
        data: { action: "preview", version, operations: [operation] },
      })
    ).ok(),
  ).toBe(true);
  const restored: { data: Data } = await (
    await page.request.get("/api/data")
  ).json();
  expect(
    restored.data.employees.find((e) => e.id === employee.id)
      ?.weekly_availability,
  ).toEqual(employee.weekly_availability);
});
