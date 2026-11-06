import { test, expect } from "@playwright/test";

test("visitor landing offers demo while setup is separate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /סידור עבודה ברור/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "כניסה להדגמה" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /מחברים את הארגון/ }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("link", { name: "הגדרה וחיבור המערכת לארגון" }).click();
  await expect(
    page.getByRole("heading", { name: "מחברים את הארגון, ואז מתחילים לעבוד" }),
  ).toBeVisible();
});

test("landing and demo fit phone and navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "כניסה להדגמה" }).click();
  await expect(
    page.getByText("מצב הדגמה — נתונים לדוגמה", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "תפריט", exact: true }).click();
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "דניאל לוי" }),
  ).toBeVisible();
  await page.screenshot({ path: "work/mobile-employees.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
