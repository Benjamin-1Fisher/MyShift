import { test, expect } from "@playwright/test";
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
  await shift
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await shift
    .getByLabel("תפקיד", { exact: true })
    .selectOption({ label: "סיירים" });
  await shift
    .getByLabel("עובד במשמרת")
    .selectOption({ label: "עובד בדיקה פיקטיבי" });
  await shift.getByLabel("התחלה", { exact: true }).fill("23:00");
  await shift.getByLabel("סיום", { exact: true }).fill("07:00");
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
