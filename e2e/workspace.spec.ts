import { test, expect } from "@playwright/test";
import { board, exact, navigation, openMain } from "./workspace-controls";

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

test("mobile drawer dismisses outside and returns keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 472, height: 904 });
  await page.goto("/demo");
  const trigger = page.getByRole("button", { name: "תפריט", exact: true });
  const drawer = page.getByRole("dialog", { name: "תפריט ניווט" });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "סגירת תפריט" }),
  ).toBeFocused();
  await page.mouse.click(24, 300);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).toBeHidden();
  await expect(navigation(page)).toBeVisible();
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
  await expect(controls.getByText("דמו", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("region", { name: "מצב הדגמה" }),
  ).toHaveCount(0);
  const topbar = page.locator(".topbar");
  await expect(organization).toHaveAttribute("href", "/app");
  await expect(controls).not.toContainText("נתונים לדוגמה");
  await expect(controls).not.toContainText("השינויים נשמרים");
  for (const width of [320, 472, 1440]) {
    await page.setViewportSize({ width, height: 904 });
    const viewBox = (await view.boundingBox())!;
    const linkBox = (await organization.boundingBox())!;
    expect(Math.abs(viewBox.y - linkBox.y)).toBeLessThan(2);
    expect(viewBox.y + viewBox.height).toBeLessThan(
      (await topbar.boundingBox())!.y,
    );
    expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(width);
    expect(linkBox.x).toBeGreaterThanOrEqual(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 250));
  await expect
    .poll(async () => {
      const box = await controls.boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("region", { name: "לוח שבועי לכל המחלקות" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "תפריט", exact: true }).click();
  await expect(navigation(page).getByRole("button")).toHaveText([
    "סידור עבודה",
    "צוות",
    "הגדרות",
  ]);
  await openMain(page, "צוות");
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

test("department week range and return to current week fit on one line", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-22T09:00:00Z"));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/demo?view=department&week=2026-12-27");
  const nav = page.getByRole("group", { name: "ניווט בין שבועות" });
  const range = nav.locator("bdi");
  const back = page.getByRole("button", { name: "השבוע", exact: true });
  await expect(range).toHaveText("27.12.2026–02.01.2027");
  await expect(back).toBeVisible();

  for (const width of [320, 375, 472]) {
    await page.setViewportSize({ width, height: 844 });
    const [previousBox, rangeBox, nextBox, backBox] = await Promise.all(
      [
        nav.getByRole("button", { name: "שבוע קודם", exact: true }),
        range,
        nav.getByRole("button", { name: "שבוע הבא", exact: true }),
        back,
      ].map((item) => item.boundingBox()),
    );
    const center = (box: NonNullable<typeof rangeBox>) =>
      box.y + box.height / 2;
    expect(Math.abs(center(backBox!) - center(rangeBox!))).toBeLessThan(2);
    expect(previousBox!.x).toBeGreaterThanOrEqual(
      rangeBox!.x + rangeBox!.width,
    );
    expect(nextBox!.x + nextBox!.width).toBeLessThanOrEqual(rangeBox!.x);
    expect(backBox!.x).toBeGreaterThanOrEqual(0);
    expect(
      await range.evaluate((element) => element.getClientRects().length),
    ).toBe(1);
  }

  await back.click();
  await expect(range).toHaveText("22.11–28.11.2026");
  await expect(back).toBeHidden();
});

test("demo reset requires confirmation and restores the current week in open demo tabs", async ({
  page,
  context,
}) => {
  const time = new Date("2026-11-22T09:00:00Z");
  await page.clock.setFixedTime(time);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/demo?week=2026-12-06&view=department");
  const controls = page.getByRole("region", exact("מצב הדגמה"));
  const reset = controls.getByRole("button", exact("איפוס ההדגמה"));
  await expect(reset).toBeVisible();
  await page.evaluate(() => {
    const key = "myshift.demo.v1";
    const demo = JSON.parse(localStorage.getItem(key)!);
    demo.data.employees[0].name = "עובד ששונה";
    demo.data.shift_assignments.pop();
    localStorage.setItem(key, JSON.stringify(demo));
    localStorage.setItem("myshift.synthetic-team.v1", "[{}]");
    localStorage.setItem("unrelated-storage", "keep");
  });
  await page.reload();
  await controls.getByRole("combobox").selectOption({ label: "עובד · עובד ששונה" });
  const other = await context.newPage();
  await other.clock.setFixedTime(time);
  await other.goto("/demo?week=2026-12-13");
  await expect(board(other)).toBeVisible();

  await reset.click();
  const confirm = page.getByRole("dialog", exact("לאפס את ההדגמה?"));
  const cancel = confirm.getByRole("button", exact("ביטול"));
  await expect(confirm).toContainText("השינויים המקומיים שביצעת בדמו יימחקו");
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(reset).toBeFocused();
  await expect(page).toHaveURL(/week=2026-12-06/);
  await expect(controls.getByRole("combobox")).toContainText("עובד ששונה");

  await reset.click();
  await confirm.getByRole("button", exact("איפוס ההדגמה")).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(other).toHaveURL(/\/demo$/);
  for (const tab of [page, other]) {
    await expect(board(tab)).toBeVisible();
    await expect(board(tab).getByRole("group", exact("בחירת שבוע"))).toHaveText("22.11–28.11.2026");
  }
  await expect(controls.getByRole("combobox")).toHaveValue("");
  expect(await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("myshift.demo.v1")!);
    return {
      renamedEmployee: store.data.employees.some((employee: { name: string }) => employee.name === "עובד ששונה"),
      receipts: localStorage.getItem("myshift.synthetic-team.v1"),
      unrelated: localStorage.getItem("unrelated-storage"),
    };
  })).toEqual({ renamedEmployee: false, receipts: null, unrelated: "keep" });
});
