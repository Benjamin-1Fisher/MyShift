import { test, expect } from "@playwright/test";

test("demo full journey persists employees, shifts and publication without API calls", async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    api: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) api.push(r.url());
  });
  await page.goto("/");
  await page.screenshot({ path: "work/landing.png", fullPage: true });
  await page.getByRole("link", { name: "כניסה להדגמה" }).click();
  await expect(
    page.getByRole("heading", { name: "יום עבודה מסודר מתחיל כאן" }),
  ).toBeVisible();
  await expect(page.locator(".stats")).toContainText("21");
  await expect(page.locator(".stats")).toContainText("8");
  await page.screenshot({ path: "work/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("שם תצוגה", { exact: true }).fill("רוני הדגמה");
  await dialog
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await dialog.getByLabel("תפקיד / הכשרה").selectOption({ label: "סייר" });
  await dialog.getByRole("button", { name: "המשך", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const employee = page.getByRole("row").filter({ hasText: "רוני הדגמה" });
  await expect(employee).toContainText("סיירים / סייר");
  await employee.getByRole("button", { name: "עריכה", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("שם", { exact: true })
    .fill("רוני סייר הדגמה");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "המשך", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "רוני סייר הדגמה" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "סיירים" });
  await dialog
    .getByLabel("אתר", { exact: true })
    .selectOption({ label: "מתחם צפון" });
  await dialog.getByLabel("תפקיד / הכשרה").selectOption({ label: "סייר" });
  await dialog.getByLabel("התחלה", { exact: true }).fill("23:00");
  await dialog.getByLabel("סיום", { exact: true }).fill("07:00");
  await dialog.getByRole("button", { name: "המשך", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "בדיקת שינוי ואישור" }),
  ).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.getByRole("button", { name: "אישור וביצוע" }).click();
  await expect(page.locator(".shift")).toHaveCount(22);
  const open = page
    .locator(".shift")
    .filter({ hasText: "23:00 – 07:00" })
    .filter({ hasText: "דרוש שיבוץ" });
  await open.click();
  await page
    .getByRole("dialog")
    .getByLabel("עובד (אפשר להשאיר פתוח)")
    .selectOption({ label: "רוני סייר הדגמה" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "המשך", exact: true })
    .click();
  await page.getByRole("button", { name: "אישור וביצוע" }).click();
  await expect(
    page.locator(".shift").filter({ hasText: "רוני סייר הדגמה" }),
  ).toContainText("למחרת");
  await page.getByRole("button", { name: "פרסום סידור", exact: true }).click();
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page.screenshot({ path: "work/published.png", fullPage: true });
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · רוני סייר הדגמה" });
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("רוני סייר הדגמה");
  await expect(
    page.getByRole("button", { name: "הוספת משמרת", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "סידורי עבודה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(22);
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "רוני סייר הדגמה" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /עוזר AI/ }).click();
  await expect(
    page.getByRole("heading", { name: "עוזר AI — בקרוב" }),
  ).toBeVisible();
  await expect(page.getByLabel("בקשה לעוזר")).toBeDisabled();
  await expect(page.locator(".chat-input button")).toBeDisabled();
  const second = await context.newPage();
  await second.goto("/demo");
  await second
    .getByRole("button", { name: "סידורי עבודה", exact: true })
    .click();
  await expect(second.locator(".shift")).toHaveCount(22);
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
});

test("demo checks overlap and draft visibility; production stays isolated", async ({
  page,
  browser,
}) => {
  await page.goto("/demo");
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · דניאל לוי" });
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.getByLabel("תצוגת הדגמה").selectOption({ label: "מנהל" });
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("מחלקה", { exact: true })
    .selectOption({ label: "אחמ״שים" });
  await dialog
    .getByLabel("אתר", { exact: true })
    .selectOption({ label: "מתחם מרכז" });
  await dialog.getByLabel("תפקיד / הכשרה").selectOption({ label: "אחמ״ש" });
  await dialog
    .getByLabel("עובד (אפשר להשאיר פתוח)")
    .selectOption({ label: "דניאל לוי" });
  await dialog.getByRole("button", { name: "המשך", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("חופפת");
  await dialog.getByRole("button", { name: "סגירה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "המערכת הארגונית עדיין לא מחוברת" }),
  ).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  const isolated = await browser.newContext();
  const fresh = await isolated.newPage();
  await fresh.goto("/demo");
  await fresh.getByRole("button", { name: "עובדים", exact: true }).click();
  await expect(fresh.locator("tbody tr")).toHaveCount(8);
  await isolated.close();
});

test("storage failure is explicit and does not claim success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.goto("/demo");
  await expect(page.locator("p[role=alert]")).toContainText("השינוי לא נשמר");
  await expect(
    page.getByRole("button", { name: "הוספת משמרת", exact: true }),
  ).toHaveCount(0);
});
