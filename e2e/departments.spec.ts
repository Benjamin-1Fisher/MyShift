import { test, expect } from "@playwright/test";
test("departments isolate workers, templates, custom overnight shifts and publication on desktop and phone", async ({
  page,
}) => {
  await page.goto("/demo");
  const tabs = page.getByRole("tablist", { name: "מחלקות" });
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  await expect(page.locator(".shift")).toHaveCount(7);
  await expect(page.locator(".week-grid .day-column")).toHaveCount(7);
  await expect(page.locator(".shift select").first()).not.toContainText(
    "מאיה ישראלי",
  );
  await tabs.getByRole("tab", { name: "סיירים", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(14);
  await expect(page.locator(".shift select").first()).not.toContainText(
    "דניאל לוי",
  );
  await tabs.getByRole("tab", { name: "חניונים", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("מחלקה", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("התחלה", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("סיום", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("עובד במשמרת")).not.toContainText("דניאל לוי");
  await dialog.getByLabel("התחלה", { exact: true }).fill("21:30");
  await dialog.getByLabel("סיום", { exact: true }).fill("04:30");
  await dialog
    .getByLabel("עובד במשמרת")
    .selectOption({ label: "חניונים — עובד לדוגמה 1" });
  await dialog
    .getByRole("button", { name: "שמירת משמרת", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("למחרת");
  await page.locator(".shift-main").click();
  await dialog.getByLabel("התחלה", { exact: true }).fill("22:00");
  await dialog
    .getByRole("button", { name: "שמירת משמרת", exact: true })
    .click();
  await expect(page.locator(".shift-time")).toContainText("22:00");
  await page.getByRole("button", { name: "פרסום סידור", exact: true }).click();
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: "סיירים", exact: true }).click();
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(14);
  await page.setViewportSize({ width: 390, height: 844 });
  await tabs.getByRole("tab", { name: "קבלה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "work/department-mobile.png", fullPage: true });
  await tabs.getByRole("tab", { name: "חניונים", exact: true }).click();
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(
    page.getByRole("tab", { name: "חניונים", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "work/department-desktop.png",
    fullPage: true,
  });
});

test("managers explicitly configure separate reception hours and day-specific staffing", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("tab", { name: "קבלה", exact: true }).click();
  await page.getByText("ניהול נוסף", { exact: true }).click();
  await page.getByRole("button", { name: "הגדרות", exact: true }).click();
  await expect(
    page.getByText("שעות לא מאומתות — אין להשתמש לשיבוץ", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "תבנית משמרת חדשה", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("שם", { exact: true })
    .fill("קבלה בשעות שהוגדרו לבדיקה");
  await form.getByLabel("התחלה", { exact: true }).fill("09:30");
  await form.getByLabel("סיום (רק אם אומת)", { exact: true }).fill("16:30");
  await form.getByLabel("שעות מאומתות", { exact: true }).selectOption("true");
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await page
    .getByRole("button", { name: "דרישת איוש חדשה", exact: true })
    .click();
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "קבלה" });
  await form
    .getByLabel("אתר", { exact: true })
    .selectOption({ label: "מתחם מרכז" });
  await form.getByLabel("יום", { exact: true }).selectOption("0");
  await form.getByLabel("התחלה", { exact: true }).fill("09:30");
  await form.getByLabel("סיום", { exact: true }).fill("16:30");
  await form.getByLabel("מספר עובדים").fill("2");
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("button", { name: "סידורי עבודה", exact: true }).click();
  await page
    .getByRole("button", { name: "יצירת סידור בקליק", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(2);
  await expect(page.locator(".shift-time").first()).toContainText("09:30");
  await page.getByRole("tab", { name: "אחמ״שים", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(7);
  await expect(page.locator(".shift-time").first()).toContainText("07:00");
});
