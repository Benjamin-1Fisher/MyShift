import { test, expect, type Page } from "@playwright/test";
import type { Data } from "../src/lib/domain";
import {
  board,
  chooseDepartment,
  clickWeekAction,
  exact,
  navigation,
  openMain,
} from "./workspace-controls";

async function assertWorkerExcluded(page: Page, worker: string) {
  await page.locator(".shift-main").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("עובד במשמרת")).not.toContainText(worker);
  await dialog.getByRole("button", exact("סגירה")).click();
}
test("departments isolate workers, templates, custom overnight shifts and publication on desktop and phone", async ({
  page,
}) => {
  await page.goto("/demo?view=department");

  await expect(page.locator(".shift")).toHaveCount(7);
  await expect(page.locator(".week-grid .day-column")).toHaveCount(7);
  await assertWorkerExcluded(page, "מאיה ישראלי");
  await chooseDepartment(page, "אחמ״שים", "סיירים");
  await expect(page.locator(".shift")).toHaveCount(14);
  await assertWorkerExcluded(page, "דניאל לוי");
  const parking = page.getByRole("button", { name: "חניונים", exact: true });
  await page
    .getByRole("button", { name: "חזרה לכל המחלקות", exact: true })
    .click();
  await page.getByRole("button", { name: "השבוע הבא", exact: true }).click();
  await parking.click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const shiftDepartment = dialog.getByRole("combobox", exact("מחלקה"));
  await expect(shiftDepartment).toBeDisabled();
  await expect(shiftDepartment.locator("option:checked")).toHaveText("חניונים");
  await expect(dialog.getByLabel("התחלה", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("סיום", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("עובד במשמרת")).not.toContainText("דניאל לוי");
  await dialog.getByLabel("התחלה", { exact: true }).fill("21:30");
  await dialog.getByLabel("סיום", { exact: true }).fill("04:30");
  await dialog
    .getByLabel("עובד במשמרת")
    .selectOption({ label: "חניונים — עובד לדוגמה 1" });
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("למחרת");
  await page.locator(".shift-main").click();
  await dialog
    .locator("summary")
    .filter({ hasText: /^\s*פרטי משמרת\s*$/ })
    .click();
  await dialog.getByLabel("התחלה", { exact: true }).fill("22:00");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.locator(".shift-time")).toContainText("22:00");
  await clickWeekAction(page, "פרסום סידור");
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "חזרה לכל המחלקות", exact: true })
    .click();
  await page.getByRole("button", { name: "השבוע", exact: true }).click();
  await page.getByRole("button", { name: "סיירים", exact: true }).click();
  await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(14);
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseDepartment(page, "סיירים", "קבלה");
  await expect(page.locator(".shift")).toHaveCount(14);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "work/department-mobile.png", fullPage: true });
  await chooseDepartment(page, "קבלה", "חניונים");
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(14);
  await expect(
    page.getByRole("button", exact("מחלקה · חניונים")),
  ).toBeVisible();
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
  await chooseDepartment(page, "אחמ״שים", "קבלה");
  await openMain(page, "הגדרות");
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
    .getByRole("combobox", exact("אתר"))
    .selectOption({ label: "מתחם מרכז" });
  await form.getByLabel("יום", { exact: true }).selectOption("0");
  await form.getByLabel("התחלה", { exact: true }).fill("09:30");
  await form.getByLabel("סיום", { exact: true }).fill("16:30");
  await form.getByLabel("מספר עובדים").fill("2");
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "סידור עבודה", exact: true })
    .click();
  await page.getByRole("button", { name: "השבוע הבא", exact: true }).click();
  await page
    .getByRole("region", { name: "לוח שבועי לכל המחלקות" })
    .getByRole("button", { name: "קבלה", exact: true })
    .click();
  await clickWeekAction(page, "יצירת סידור");
  await expect(page.locator(".shift")).toHaveCount(2);
  await expect(page.locator(".shift-time").first()).toContainText("09:30");
  await page
    .getByRole("button", { name: "חזרה לכל המחלקות", exact: true })
    .click();
  await page.getByRole("button", { name: "השבוע", exact: true }).click();
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
  await expect(navigation(page).getByRole("button")).toHaveText([
    "סידור עבודה",
    "צוות",
    "הגדרות",
  ]);
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
  await expect(matrix.getByText("משמרת פנויה", { exact: true })).toBeVisible();
  expect(
    await matrix.evaluate(
      (el) =>
        el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1,
    ),
  ).toBe(true);
  const gaps = board.getByRole("button", { name: /פנויות לשיבוץ/ });
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
  await expect(page.getByRole("button", exact("מחלקה · סיירים"))).toBeVisible();

  await page
    .getByRole("combobox", { name: "תצוגת הדגמה" })
    .selectOption({ label: "עובד · דניאל לוי" });
  await expect(board).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "סידור עבודה", exact: true }),
  ).toHaveCount(0);
});

test("a manager can fill the flagged shift and see the weekly board update", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo?view=organization");
  const board = page.getByRole("region", { name: "לוח שבועי לכל המחלקות" });
  await board.getByRole("button", { name: /^שיבוץ .*משמרת פנויה/ }).click();
  const form = page.getByRole("dialog", { name: /עריכת משמרת|שיבוץ עובד/ });
  const workers = form.getByRole("combobox", {
    name: "עובד במשמרת",
    exact: true,
  });
  await expect(workers).toBeFocused();
  await expect(form.getByLabel("התחלה", { exact: true })).toBeHidden();
  const candidate = workers
    .locator('option:not([disabled]):not([value=""])')
    .first();
  const id = await candidate.getAttribute("value");
  expect(id).toBeTruthy();
  await workers.selectOption(id!);
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).toHaveCount(0);
  const openShifts = board.getByRole("button", { name: /פנויות לשיבוץ/ });
  await expect(openShifts).toContainText("0");
  await expect(
    board.getByRole("button", { name: /^שיבוץ .*משמרת פנויה/ }),
  ).toHaveCount(0);
  await page.getByRole("button", exact("ביטול הפעולה האחרונה")).click();
  await expect(openShifts).toContainText("1");
  await board.getByRole("button", { name: /^שיבוץ .*משמרת פנויה/ }).click();
  await workers.selectOption(id!);
  await form.getByRole("button", exact("שמירה")).click();
  await expect(openShifts).toContainText("0");
  await board.getByRole("button", exact("סיירים")).click();
  await page.getByRole("button", exact("חזרה לכל המחלקות")).click();

  const storedSchedule = () =>
    page.evaluate(() => localStorage.getItem("myshift.demo.v1"));
  const beforeRecovery = await storedSchedule();
  const recoveryUrl = page.url();
  expect(new URL(recoveryUrl).searchParams.get("department")).toBeTruthy();
  expect(beforeRecovery).toBeTruthy();
  const bootstrapScripts = /\/_next\/static\/.*\.js(?:\?|$)/;
  await page.route(bootstrapScripts, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "טוענים את ההדגמה" }),
  ).toBeVisible();
  const recovery = page.getByRole("link", {
    name: "טעינת ההדגמה מחדש",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  expect(await storedSchedule()).toBe(beforeRecovery);
  await page.unroute(bootstrapScripts);
  const navigated = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(),
  });
  await recovery.click();
  await navigated;
  await expect(page).toHaveURL(recoveryUrl);
  await expect(openShifts).toContainText("0");
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
  await board.getByRole("button", { name: /פנויות לשיבוץ/ }).click();
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
  await expect(sheet.getByText("משמרת פנויה", { exact: true })).toBeVisible();
  await expect(sheet.getByText("נתוני דוגמה בלבד")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".org-mobile")).toBeHidden();
});

test("weekly planning previews without saving, rejects stale drafts, and preserves assigned shifts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 472, height: 904 });
  await page.clock.setFixedTime(new Date("2026-11-25T12:00:00Z"));
  await page.goto("/demo");
  const roster = board(page);
  const plan = roster.getByRole("button", exact("תכנון שבועי"));
  const department = roster.getByRole(
    "button",
    exact("סינון לפי מחלקה · כל המחלקות"),
  );
  await expect(plan).toBeVisible();
  for (const width of [472, 320]) {
    await page.setViewportSize({ width, height: 904 });
    expect((await plan.boundingBox())!.y).toBe(
      (await department.boundingBox())!.y,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }

  const storageKey = "myshift.demo.v1";
  const snapshot = () =>
    page.evaluate((key) => {
      const { schedule_versions, shift_assignments } = (
        JSON.parse(localStorage.getItem(key)!) as { data: Data }
      ).data;
      return { schedule_versions, shift_assignments };
    }, storageKey);
  const before = await snapshot();
  const target = before.schedule_versions.find(
    (row) => row.week_start === "2026-11-22" && row.status === "draft",
  )!;
  const dialog = page.getByRole("dialog", exact("תכנון שבועי"));
  const save = dialog.getByRole("button", exact("אישור ושמירה כטיוטה"));
  await plan.click();
  await expect(
    dialog.getByRole("button", exact("מחלקה לתכנון · אחמ״שים")),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  expect(await snapshot()).toEqual(before);
  await dialog.getByRole("button", exact("ביטול")).click();
  await expect(dialog).toBeHidden();
  expect(await snapshot()).toEqual(before);

  await plan.click();
  await page.evaluate(
    ({ key, versionId }) => {
      const store = JSON.parse(localStorage.getItem(key)!) as { data: Data };
      const row = store.data.schedule_versions.find(
        (row) => row.id === versionId,
      )!;
      row.revision = Number(row.revision) + 1;
      localStorage.setItem(key, JSON.stringify(store));
    },
    { key: storageKey, versionId: target.id },
  );
  const current = await snapshot();
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("הסידור השתנה");
  expect(await snapshot()).toEqual(current);

  await dialog.getByRole("button", exact("רענון הצעה")).click();
  await save.click();
  await expect(dialog).toBeHidden();
  const after = await snapshot();
  expect(after.shift_assignments.length).toBeGreaterThan(
    current.shift_assignments.length,
  );
  expect(after.shift_assignments).toEqual(
    expect.arrayContaining(current.shift_assignments),
  );
  expect(
    after.schedule_versions.find((row) => row.id === target.id),
  ).toMatchObject({
    status: "draft",
    revision: Number(target.revision) + 2,
  });
  expect(after.schedule_versions.filter((row) => row.id !== target.id)).toEqual(
    before.schedule_versions.filter((row) => row.id !== target.id),
  );

  await page.goto("/demo?week=2026-12-27");
  await expect(plan).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("synthetic payroll reaches the selected employee, and birthdays stay in the manager view", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-24T12:00:00Z"));
  await page.goto("/demo");
  await openMain(page, "צוות");
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
  await openMain(page, "הפרופיל שלי");
  await page.getByRole("button", { name: "התלושים שלי", exact: true }).click();
  await expect(inbox.locator("summary")).toHaveCount(1);
});

test("mobile weekly navigation stays compact and keeps context with 13 long department names", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-22T09:00:00Z"));
  await page.setViewportSize({ width: 472, height: 904 });
  await page.goto("/demo");
  const roster = board(page);
  await expect(roster.getByRole("button", exact("אחמ״שים"))).toBeVisible();

  const names = Array.from(
    { length: 9 },
    (_, i) => `מחלקת תפעול ובקרה אזורית · תחנה ${i + 1}`,
  );
  await page.evaluate((names) => {
    const key = "myshift.demo.v1";
    const saved = JSON.parse(localStorage.getItem(key)!);
    const data = saved.data;
    const shift = data.shift_assignments[0];
    const version = data.schedule_versions.find(
      (v: { id: string }) => v.id === shift.version_id,
    );
    for (const name of names) {
      const department = {
        id: crypto.randomUUID(),
        name,
        color: "#5f658e",
        active: true,
      };
      const role = {
        id: crypto.randomUUID(),
        department_id: department.id,
        name: "תורן",
      };
      const employee = {
        id: crypto.randomUUID(),
        name: "עובד בדיקה",
        active: true,
      };
      const schedule = {
        ...version,
        id: crypto.randomUUID(),
        department_id: department.id,
      };
      data.departments.push(department);
      data.roles.push(role);
      data.employees.push(employee);
      data.employee_departments.push({
        id: crypto.randomUUID(),
        department_id: department.id,
        role_id: role.id,
        employee_id: employee.id,
      });
      data.schedule_versions.push(schedule);
      data.shift_assignments.push({
        ...shift,
        id: crypto.randomUUID(),
        department_id: department.id,
        role_id: role.id,
        employee_id: employee.id,
        version_id: schedule.id,
      });
    }
    localStorage.setItem(key, JSON.stringify(saved));
  }, names);
  await page.reload();

  const departments = roster.locator(".org-mobile-department");
  await expect(departments).toHaveCount(13);
  await expect(
    departments.first().locator(".org-shift").first(),
  ).toBeInViewport();
  const days = roster.getByRole("group", exact("בחירת יום"));
  const dayButtons = days.getByRole("button");
  await expect(dayButtons).toHaveCount(7);
  for (const width of [320, 390, 472]) {
    await page.setViewportSize({ width, height: 904 });
    const locations = await dayButtons.evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    expect(new Set(locations).size).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }

  const filter = roster.getByRole("button", {
    name: /סינון לפי מחלקה · כל המחלקות/,
  });
  await filter.click();
  const search = roster.getByRole("textbox", exact("חיפוש מחלקה"));
  await expect(search).toBeFocused();
  await search.fill("תחנה 9");
  await search.press("Enter");
  await expect(departments).toHaveCount(1);
  await roster.getByRole("button", { name: /ממתינים לפרסום/ }).click();
  const date = await days
    .getByRole("button", { name: /^ראשון/ })
    .getAttribute("aria-label");
  await departments.getByRole("button", exact(names[8])).click();
  await page.getByRole("button", exact("חזרה לכל המחלקות")).click();
  await expect(
    roster.getByRole("button", { name: /ממתינים לפרסום/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    roster.getByRole("button", {
      name: new RegExp("סינון לפי מחלקה .* תחנה 9"),
    }),
  ).toBeVisible();
  await expect(days.getByRole("button", exact(date!))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(departments).toHaveCount(1);

  await roster.getByRole("button", { name: /סינון לפי מחלקה/ }).click();
  await roster
    .getByRole("group", exact("סינון לפי מחלקה"))
    .getByRole("button", exact("כל המחלקות"))
    .click();
  await roster.getByRole("button", { name: /ממתינים לפרסום/ }).click();
  const lastDepartment = departments.getByRole("button", exact(names[8]));
  await lastDepartment.scrollIntoViewIfNeeded();
  const boardScroll = await page.evaluate(() => scrollY);
  expect(boardScroll).toBeGreaterThan(0);
  await lastDepartment.click();
  await page.getByRole("button", exact("חזרה לכל המחלקות")).click();
  await expect
    .poll(async () =>
      Math.abs((await page.evaluate(() => scrollY)) - boardScroll),
    )
    .toBeLessThan(4);

  await days.getByRole("button", { name: /^שבת/ }).click();
  await roster.getByRole("button", { name: /פנויות לשיבוץ/ }).click();
  await expect(roster.getByText("אין תוצאות ביום הזה.")).toBeVisible();
  await roster.getByRole("button", { name: /^מעבר ליום חמישי/ }).click();
  await expect(days.getByRole("button", { name: /^חמישי/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    roster.getByRole("button", { name: /^שיבוץ .*משמרת פנויה/ }),
  ).toBeVisible();
  await roster.getByRole("button", { name: /פנויות לשיבוץ/ }).click();

  await page.setViewportSize({ width: 1440, height: 1000 });
  const matrix = roster
    .getByRole("region", exact("טבלת סידור שבועית"))
    .getByRole("table");
  await expect(matrix.getByRole("rowheader")).toHaveCount(13);
  await expect(matrix.getByRole("columnheader")).toHaveCount(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("stale shift edits stay open and can reload the latest assignment", async ({
  page,
  context,
}) => {
  await page.goto("/demo?view=department");
  const card = page.locator(".shift").first();
  const edit = card.getByRole("button");
  await edit.focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("dialog");
  const worker = form.getByLabel("עובד במשמרת");
  await expect(worker).toBeFocused();
  await worker.selectOption({ label: "נועה כהן" });

  const second = await context.newPage();
  await second.goto("/demo?view=department");
  await second.locator(".shift-main").first().click();
  const other = second.getByRole("dialog");
  await other.getByLabel("עובד במשמרת").selectOption("");
  await other.getByRole("button", exact("שמירה")).click();
  await expect(other).toBeHidden();
  await expect(second.locator(".shift").first()).toContainText("משמרת פנויה");

  await form.getByRole("button", exact("שמירה")).click();
  await expect(form.getByRole("alert")).toContainText(/השתנ|רעננ/);
  await expect(form).toBeVisible();
  await form.getByRole("button", exact("טעינת הפרטים העדכניים")).click();
  await expect(worker).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(card).toContainText("משמרת פנויה");
});
