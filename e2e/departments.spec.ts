import { test, expect } from "@playwright/test";
test("departments isolate workers, templates, custom overnight shifts and publication on desktop and phone", async ({
  page,
}) => {
  await page.goto("/demo?view=department");
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
  const parking = page.getByRole("button", { name: "חניונים", exact: true });
  await page.getByRole("button", { name: "חזרה ללוח השבועי", exact: true }).click();
  await page.getByRole("button", { name: "השבוע הבא", exact: true }).click();
  await parking.click();
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
  await page.getByRole("button", { name: "חזרה ללוח השבועי", exact: true }).click();
  await page.getByRole("button", { name: "השבוע הנוכחי", exact: true }).click();
  await page.getByRole("button", { name: "סיירים", exact: true }).click();
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(14);
  await page.setViewportSize({ width: 390, height: 844 });
  await tabs.getByRole("tab", { name: "קבלה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(14);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "work/department-mobile.png", fullPage: true });
  await tabs.getByRole("tab", { name: "חניונים", exact: true }).click();
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(14);
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
  await page.goto("/demo?view=department");
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
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "כל הסידורים השבועיים", exact: true })
    .click();
  await page.getByRole("button", { name: "השבוע הבא", exact: true }).click();
  await page
    .getByRole("region", { name: "לוח שבועי לכל המחלקות" })
    .getByRole("button", { name: "קבלה", exact: true })
    .click();
  await page
    .getByRole("button", { name: "יצירת סידור בקליק", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(2);
  await expect(page.locator(".shift-time").first()).toContainText("09:30");
  await page.getByRole("button", { name: "חזרה ללוח השבועי", exact: true }).click();
  await page.getByRole("button", { name: "השבוע הנוכחי", exact: true }).click();
  await page.getByRole("button", { name: "אחמ״שים", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(7);
  await expect(page.locator(".shift-time").first()).toContainText("07:00");
});

test("organization board shows all departments across the week, flags gaps and remains private to managers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo?department=20000000-0000-4000-8000-000000000002");
  const board = page.getByRole("region", { name: "לוח שבועי לכל המחלקות" });
  const matrix = board.getByRole("table");
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button").first()).toHaveText(
    "כל הסידורים השבועיים",
  );
  await expect(
    nav.getByRole("button", { name: "סידורי עבודה", exact: true }),
  ).toHaveCount(0);
  await expect(
    board.getByRole("complementary", { name: "דורש טיפול השבוע" }),
  ).toContainText("סיירים");
  await board.getByRole("button", { name: "שבץ עובד", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "עריכת משמרת" })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "סגירה", exact: true })
    .click();
  await page
    .getByRole("button", { name: "חזרה ללוח השבועי", exact: true })
    .click();
  await expect(matrix.getByRole("columnheader")).toHaveCount(8);
  await expect(matrix.getByRole("rowheader")).toHaveCount(4);
  for (const department of ["קבלה", "חניונים"]) {
    const row = matrix.getByRole("row").filter({
      has: page.getByRole("button", { name: department, exact: true }),
    });
    await expect(row.getByRole("listitem")).toHaveCount(14);
  }
  await expect(matrix.getByText("דניאל לוי").first()).toBeVisible();
  await expect(matrix.getByText(/מתחם מרכז/).first()).toBeVisible();
  await expect(matrix.getByText("פתוחה לשיבוץ").first()).toBeVisible();
  expect(
    await matrix.evaluate(
      (el) =>
        el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1,
    ),
  ).toBe(true);
  const gaps = board.getByRole("button", { name: /פתוחות לשיבוץ/ });
  await gaps.click();
  await expect(gaps).toHaveAttribute("aria-pressed", "true");
  await expect(matrix.getByText("דניאל לוי")).toHaveCount(0);
  await gaps.click();

  await page.setViewportSize({ width: 390, height: 844 });
  const days = board.getByRole("group", { name: "בחירת יום" });
  await expect(days.getByRole("button")).toHaveCount(7);
  await days.getByRole("button", { name: /^שבת/ }).click();
  await expect(board.getByRole("heading", { name: /^שבת/ })).toBeVisible();
  await expect(
    board.getByRole("button", { name: "סיירים", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await board.getByRole("button", { name: "סיירים", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "סיירים", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  await page
    .getByRole("combobox", { name: "תצוגת הדגמה" })
    .selectOption({ label: "עובד · דניאל לוי" });
  await expect(board).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "כל הסידורים השבועיים", exact: true }),
  ).toHaveCount(0);
});

test("a manager can fill the flagged shift and see the weekly board update", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo?view=organization");
  const board = page.getByRole("region", { name: "לוח שבועי לכל המחלקות" });
  await board.getByRole("button", { name: "שבץ עובד", exact: true }).click();
  const form = page.getByRole("dialog", { name: "עריכת משמרת" });
  const workers = form.getByRole("combobox", {
    name: "עובד במשמרת",
    exact: true,
  });
  await expect(workers).toBeVisible();
  const candidate = workers
    .locator('option:not([disabled]):not([value=""])')
    .first();
  const id = await candidate.getAttribute("value");
  expect(id).toBeTruthy();
  await workers.selectOption(id!);
  await form.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page
    .getByRole("button", { name: "חזרה ללוח השבועי", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "0 פתוחות לשיבוץ", exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "שבץ עובד", exact: true }),
  ).toHaveCount(0);
  await expect(
    board.getByRole("complementary", { name: "דורש טיפול השבוע" }),
  ).toHaveCount(0);

  const storedSchedule = () =>
    page.evaluate(() => localStorage.getItem("myshift.demo.v1"));
  const beforeRecovery = await storedSchedule();
  const recoveryUrl = page.url();
  expect(new URL(recoveryUrl).searchParams.get("department")).toBeTruthy();
  expect(beforeRecovery).toBeTruthy();
  const bootstrapScripts = /\/_next\/static\/.*\.js(?:\?|$)/;
  await page.route(bootstrapScripts, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "טוענים את ההדגמה" })).toBeVisible();
  const recovery = page.getByRole("link", { name: "טעינת ההדגמה מחדש", exact: true });
  await expect(recovery).toBeVisible();
  expect(await storedSchedule()).toBe(beforeRecovery);
  await page.unroute(bootstrapScripts);
  const navigated = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(),
  });
  await recovery.click();
  await navigated;
  await expect(page).toHaveURL(recoveryUrl);
  await expect(board.getByRole("button", { name: "0 פתוחות לשיבוץ", exact: true })).toBeVisible();
  expect(await storedSchedule()).toBe(beforeRecovery);

});

test("printing from the phone view includes all seven days and ignores the open-shift filter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.print = () =>
      document.documentElement.setAttribute("data-print-requested", "yes");
  });
  await page.goto("/demo");
  const board = page.getByRole("region", { name: "לוח שבועי לכל המחלקות" });
  await board.getByRole("button", { name: /פתוחות לשיבוץ/ }).click();
  const sheet = board.locator(".org-print-sheet");
  await expect(sheet).toBeHidden();
  await board.getByRole("button", { name: "הדפסה / PDF", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-print-requested",
    "yes",
  );
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("columnheader")).toHaveCount(8);
  await expect(sheet.getByRole("rowheader")).toHaveCount(4);
  await expect(sheet.getByText("דניאל לוי").first()).toBeVisible();
  await expect(sheet.getByText("פתוחה לשיבוץ")).toBeVisible();
  await expect(sheet.getByText("נתוני דוגמה בלבד")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".org-mobile")).toBeHidden();
});

test("synthetic payroll reaches the selected employee, and birthdays stay in the manager view", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-24T12:00:00Z"));
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "תלושים ותזכורות", exact: true })
    .click();
  const desk = page.getByRole("region", { name: "תלושים ותזכורות בדמו" });
  await expect(
    desk.getByRole("region", { name: "תזכורות יום הולדת" }),
  ).toContainText("מחר");
  await desk.getByLabel("בחר עובד").selectOption({ label: "דניאל לוי" });
  await desk
    .getByRole("button", { name: "שלח תלוש דוגמה", exact: true })
    .click();
  await expect(
    desk.getByRole("button", { name: "נשלח בדמו", exact: true }),
  ).toBeDisabled();
  const mode = page.getByLabel("תצוגת הדגמה");
  const inbox = page.getByRole("region", { name: "תיבת תלושים אישית" });
  await mode.selectOption({ label: "עובד · דניאל לוי" });
  await expect(inbox.locator("summary")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "תזכורות יום הולדת" }),
  ).toHaveCount(0);
  await mode.selectOption({ label: "עובד · נועה כהן" });
  await expect(inbox.locator("summary")).toHaveCount(0);
  await mode.selectOption({ label: "מנהל" });
  await desk.getByRole("button", { name: /שלח לכל עובדי הדמו/ }).click();
  await expect(desk.getByRole("button", { name: /0 נותרו/ })).toBeDisabled();
  await mode.selectOption({ label: "עובד · נועה כהן" });
  await expect(inbox.locator("summary")).toHaveCount(1);
  await page.reload();
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · דניאל לוי" });
  await page.getByRole("button", { name: "התלושים שלי", exact: true }).click();
  await expect(inbox.locator("summary")).toHaveCount(1);
});
