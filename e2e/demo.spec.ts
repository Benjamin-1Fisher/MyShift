import { test, expect } from "@playwright/test";

test("simple staffing flow saves directly, keeps open shifts, supports undo and publishes", async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    api: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) api.push(r.url());
  });
  await page.goto("/demo");
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.screenshot({ path: "work/simple-schedule.png", fullPage: true });
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("שם תצוגה", { exact: true }).fill("רוני הדגמה");
  await dialog
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await dialog.getByLabel("תפקיד / הכשרה").selectOption({ label: "סייר" });
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "רוני הדגמה" })
    .getByRole("button", { name: "עריכה", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("שם", { exact: true })
    .fill("רוני סייר הדגמה");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "שמירה", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await dialog
    .getByLabel("אתר", { exact: true })
    .selectOption({ label: "מתחם צפון" });
  await dialog.getByRole("button", { name: /לילה/ }).click();
  await expect(dialog.getByLabel("עובד במשמרת")).toHaveValue("");
  await dialog
    .getByRole("button", { name: "שמירת משמרת", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".shift")).toHaveCount(22);
  const night = page.locator(".shift").filter({
    has: page.locator(".shift-time").filter({ hasText: "23:00 – 07:00" }),
  });
  await expect(night.locator("strong")).toHaveText("משמרת פנויה");
  await night.locator("select").selectOption({ label: "רוני סייר הדגמה" });
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await night.locator("select").selectOption("");
  await expect(night.locator("strong")).toHaveText("משמרת פנויה");
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await night.locator(".shift-main").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "מחיקת משמרת", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(22);
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await page.getByRole("button", { name: "פרסום סידור", exact: true }).click();
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · רוני סייר הדגמה" });
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift-main")).toContainText("רוני סייר הדגמה");
  await expect(
    page.getByRole("button", { name: "הוספת משמרת", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(22);
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/demo");
  await expect(second.locator(".shift")).toHaveCount(22);
  await page.getByRole("button", { name: /עוזר AI/ }).click();
  await expect(page.getByLabel("בקשה לעוזר")).toBeDisabled();
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

test("delete is recoverable after reload and restore is draft with the same shifts", async ({
  page,
}) => {
  await page.goto("/demo");
  await expect(page.locator(".shift")).toHaveCount(21);
  const readShifts = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
          .shift_assignments,
    );
  const original = await readShifts();
  await page.getByRole("button", { name: "פרסום סידור", exact: true }).click();
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "מחיקת סידור", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("21");
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.getByRole("button", { name: "מחיקת סידור", exact: true }).click();
  await page
    .getByRole("button", { name: "העברה לסל המחזור", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "שחזור סידור", exact: true }),
  ).toBeVisible();
  expect(await readShifts()).toEqual(original);
  await page.getByRole("button", { name: "שחזור סידור", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  expect(await readShifts()).toEqual(original);
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · דניאל לוי" });
  await expect(page.locator(".shift")).toHaveCount(0);
});

test("one click creates open weeks, auto assigns, avoids duplicates and copies a previous week", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await page.getByText("אפשרויות נוספות לשבוע", { exact: true }).click();
  await page
    .getByRole("button", { name: "יצירת שבוע ללא שיבוץ", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await expect(page.locator(".shift.open")).toHaveCount(21);
  await page
    .getByRole("button", { name: "שיבוץ אוטומטי", exact: true })
    .click();
  await expect(page.locator(".shift.open")).toHaveCount(0);
  await page
    .getByRole("button", { name: "יצירת סידור בקליק", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await page
    .getByRole("button", { name: "העתקת השבוע הקודם", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page
    .getByRole("button", { name: "יצירת סידור בקליק", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.reload();
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(21);
});

test("storage errors are honest and production remains separate", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "המערכת הארגונית עדיין לא מחוברת" }),
  ).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.goto("/demo");
  await expect(page.locator("p[role=alert]")).toContainText("השינוי לא נשמר");
});

test("phone planning is readable without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await expect(page.locator(".shift")).toHaveCount(21);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "work/simple-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "שמירת משמרת", exact: true }),
  ).toBeVisible();
});
