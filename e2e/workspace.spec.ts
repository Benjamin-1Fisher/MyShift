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
  const controls = page.getByRole("region", { name: "מצב הדגמה" });
  const view = controls.getByRole("combobox", { name: "תצוגת הדגמה" });
  const organization = controls.getByRole("link", { name: "למערכת הארגונית" });
  await expect(view).toBeVisible();
  await expect(organization).toHaveAttribute("href", "/app");
  await expect(controls).not.toContainText("נתונים לדוגמה");
  await expect(controls).not.toContainText("השינויים נשמרים");
  for (const width of [320, 472, 1440]) {
    await page.setViewportSize({ width, height: 904 });
    const viewBox = (await view.boundingBox())!;
    const linkBox = (await organization.boundingBox())!;
    expect(Math.abs(viewBox.y - linkBox.y)).toBeLessThan(2);
    expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(width);
    expect(linkBox.x).toBeGreaterThanOrEqual(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "לוח שבועי לכל המחלקות" }),
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
