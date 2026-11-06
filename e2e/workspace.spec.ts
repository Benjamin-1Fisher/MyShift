import { test, expect } from "@playwright/test";
test("unconfigured installation blocks operational screens instead of offering nonworking buttons", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "מחברים את הארגון, ואז מתחילים לעבוד" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "יצירת סידור שבועי" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "פתיחת Supabase" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
test("setup instructions fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
