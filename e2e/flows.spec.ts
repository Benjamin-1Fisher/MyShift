import { test, expect } from "@playwright/test";
import type { Data } from "../src/lib/domain";
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
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "סיירים" });
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "עובד בדיקה פיקטיבי" }),
  ).toBeVisible();
  // No draft exists: saving first shift creates the draft and previews atomically scoped changes.
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  const shift = page.getByRole("dialog");
  await expect(shift.getByLabel("מחלקה", { exact: true })).toBeDisabled();
  await expect(
    shift.getByLabel("מחלקה", { exact: true }).locator("option:checked"),
  ).toHaveText("סיירים");
  await shift
    .getByLabel("תפקיד", { exact: true })
    .selectOption({ label: "סיירים" });
  await shift.getByLabel("התחלה", { exact: true }).fill("23:00");
  await shift.getByLabel("סיום", { exact: true }).fill("07:00");
  await shift
    .getByLabel("עובד במשמרת")
    .selectOption({ label: "עובד בדיקה פיקטיבי" });
  await shift.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("למחרת");
  await page.reload();
  await page.getByRole("button", { name: "סידורי עבודה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await page.locator(".shift-main").click();
  await page.getByRole("button", { name: "שכפול משמרת", exact: true }).click();
  await page.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(2);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await page.getByRole("button", { name: "פרסום סידור", exact: true }).click();
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "מחיקת סידור", exact: true }).click();
  await page
    .getByRole("button", { name: "העברה לסל המחזור", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "יצירת סידור חדש", exact: true }),
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
    .getByRole("button", { name: "שמירת משמרת", exact: true })
    .click();
  await expect(page.locator(".shift.open")).toHaveCount(1);
  await page.getByText("סידורים שנמחקו (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "שחזור סידור זה", exact: true })
    .click();
  await page.getByRole("button", { name: "אישור שחזור", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  await page.getByText("ניהול נוסף", { exact: true }).click();
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
    page.getByRole("button", { name: "עובדים", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("שם תצוגה", { exact: true }).fill("עובד לילה בשישי");
  await form
    .getByLabel("מחלקה", { exact: true })
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
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
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
