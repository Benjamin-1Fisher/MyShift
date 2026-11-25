import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  board,
  clickWeekAction,
  departmentScheduleButton,
  exact,
  openMore,
  navigation,
  openDepartment,
  openMain,
  planning,
  shiftWorker,
} from "./workspace-controls";

async function saveWorker(page: Page, card: Locator, worker: string) {
  await card.locator(".shift-main").click();
  const editor = page.getByRole("dialog");
  const select = shiftWorker(editor);
  await expect(select).toBeFocused();
  await select.selectOption(worker ? { label: worker } : "");
  await editor.getByRole("button", exact("שמירה")).click();
  await expect(editor).toBeHidden();
}

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
  await page.goto("/demo?view=department");
  await expect(page.locator(".shift")).toHaveCount(7);
  await page.screenshot({ path: "work/simple-schedule.png", fullPage: true });
  await openMain(page, "צוות");
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("שם תצוגה", { exact: true }).fill("רוני הדגמה");
  await dialog
    .getByRole("combobox", exact("מחלקה"))
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
  await openDepartment(page, "סיירים");
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", exact("אתר"))
    .selectOption({ label: "מתחם צפון" });
  await dialog.getByRole("button", { name: /לילה/ }).click();
  await expect(shiftWorker(dialog)).toHaveValue("");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".shift")).toHaveCount(15);
  const night = page.locator(".shift").filter({
    has: page.locator(".shift-time").filter({ hasText: "23:00–07:00" }),
  });
  await expect(night.locator("strong")).toHaveText("משמרת פנויה");
  await saveWorker(page, night, "רוני סייר הדגמה");
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await saveWorker(page, night, "");
  await expect(night.locator("strong")).toHaveText("משמרת פנויה");
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await night.locator(".shift-main").click();
  const deleteShift = dialog.getByRole("button", {
    name: "מחיקת משמרת",
    exact: true,
  });
  await deleteShift.click();
  await expect(page.locator(".shift")).toHaveCount(15);
  await expect(dialog.getByRole("button", exact("ביטול"))).toBeFocused();
  await dialog.getByRole("button", exact("ביטול")).click();
  await expect(deleteShift).toBeFocused();
  await deleteShift.click();
  await dialog
    .getByRole("button", { name: "אישור מחיקה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(14);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(15);
  await expect(night.locator("strong")).toHaveText("רוני סייר הדגמה");
  await clickWeekAction(page, "פרסום סידור");
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · רוני סייר הדגמה" });
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("רוני סייר הדגמה");
  await expect(page.locator(".shift-main")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "הוספת משמרת", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(15);
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.locator(".shift")).toHaveCount(15);
  await expect(
    navigation(page).getByRole("button", { name: /עוזר AI/ }),
  ).toHaveCount(0);
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

test("delete is recoverable after reload and restore is draft with the same shifts", async ({
  page,
}) => {
  await page.goto("/demo?view=department");
  await expect(page.locator(".shift")).toHaveCount(7);
  const readShifts = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
          .shift_assignments,
    );
  const original = await readShifts();
  await clickWeekAction(page, "פרסום סידור");
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  await clickWeekAction(page, "העברה לסל המחזור");
  await expect(page.getByRole("dialog")).toContainText("7");
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(7);
  await clickWeekAction(page, "העברה לסל המחזור");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "העברה לסל המחזור", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await page.reload();
  expect(await readShifts()).toEqual(original);
  await clickWeekAction(page, "שחזור סידור");
  await expect(page.locator(".shift")).toHaveCount(7);
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
  await page.goto("/demo?view=department");
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await clickWeekAction(page, "יצירה ללא שיבוץ");
  await expect(page.locator(".shift")).toHaveCount(21);
  await expect(page.locator(".shift.open")).toHaveCount(21);
  await clickWeekAction(page, "שיבוץ אוטומטי");
  await expect(page.locator(".shift.open")).toHaveCount(0);
  const tools = planning(page);
  await expect(tools.getByRole("button", exact("השלמת משמרות"))).toHaveCount(0);
  await expect(tools.getByRole("button", exact("פרסום סידור"))).toBeVisible();
  await openMore(tools);
  await expect(
    tools.getByRole("button", exact("שיבוץ אוטומטי")),
  ).toBeDisabled();
  await expect(tools.getByText("אין משמרות פנויות")).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await clickWeekAction(page, "העתקת השבוע הקודם");
  await expect(page.locator(".shift")).toHaveCount(21);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await clickWeekAction(page, "יצירת סידור");
  await expect(page.locator(".shift")).toHaveCount(21);
  await page.reload();
  await expect(page.locator(".shift")).toHaveCount(21);
});

for (const button of ["יצירת סידור", "יצירה ללא שיבוץ"]) {
  test(`${button} creates morning, evening and night every day and persists readable cards`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/demo?view=department");
    await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
    await clickWeekAction(page, button);
    await expect(page.locator(".shift")).toHaveCount(21);
    for (const day of await page.locator(".day-column").all()) {
      await expect(day.locator(".shift")).toHaveCount(3);
      for (const hours of ["07:00–15:00", "15:00–23:00", "23:00–07:00"])
        await expect(
          day.locator(".shift-time").filter({ hasText: hours }),
        ).toHaveCount(1);
    }
    if (button === "יצירה ללא שיבוץ")
      await expect(page.locator(".shift.open")).toHaveCount(21);
    else await expect(page.locator(".shift:not(.open)")).not.toHaveCount(0);
    const card = page.locator(".shift").first();
    expect(
      await card
        .locator("strong")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(15);
    expect(
      await card
        .locator(".shift-time")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(13);
    expect(
      await card
        .locator("small")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(13);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        document.fonts.check('16px "Assistant Variable"', "סידור משמרות"),
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/full-week-${button === "יצירה ללא שיבוץ" ? "open" : "assigned"}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(page.locator(".shift")).toHaveCount(21);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

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
  await page.goto("/demo?view=department");
  await expect(page.locator("p[role=alert]")).toContainText("השינוי לא נשמר");
});

test("phone planning is readable without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo?view=department");
  await expect(page.locator(".shift")).toHaveCount(7);
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
      .getByRole("button", { name: "שמירה", exact: true }),
  ).toBeVisible();
});

test("employee form saves Friday-night availability and respects it in automatic and manual staffing", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo?view=department");
  await openMain(page, "צוות");
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("שם תצוגה", { exact: true }).fill("בן זמינות");
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "אחמ״ש" });
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "ניקוי בחירה", exact: true }).click();
  await form.getByLabel("לילה ביום שישי", { exact: true }).check();
  await page.screenshot({
    path: "work/employee-weekly-desktop.png",
    fullPage: true,
  });
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "בן זמינות" }),
  ).toContainText("שישי: לילה");
  await page.reload();
  await openMain(page, "צוות");
  const row = page.getByRole("row").filter({ hasText: "בן זמינות" });
  await expect(row).toContainText("שישי: לילה");
  await row.getByRole("button", { name: "עריכה", exact: true }).click();
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await expect(
    form.getByLabel("לילה ביום שישי", { exact: true }),
  ).toBeChecked();
  await expect(
    form.getByLabel("לילה ביום שבת", { exact: true }),
  ).not.toBeChecked();
  await form.getByRole("button", { name: "סגירה", exact: true }).click();
  await openDepartment(page, "אחמ״שים");
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await clickWeekAction(page, "יצירת סידור");
  await expect(page.locator(".shift")).toHaveCount(21);
  const benShifts = page
    .locator(".shift")
    .filter({ has: page.locator("strong").filter({ hasText: "בן זמינות" }) });
  await expect(benShifts).toHaveCount(1);
  await expect(benShifts.locator(".shift-time")).toHaveText("23:00–07:00");
  await expect(
    page
      .locator(".day-column")
      .filter({ has: benShifts })
      .locator(".day-header"),
  ).toContainText("שישי");
  await openMain(page, "צוות");
  await row.getByRole("button", { name: "עריכה", exact: true }).click();
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "בוקר בלבד", exact: true }).click();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(row).toContainText("בוקר בלבד · כל השבוע");
  await openDepartment(page, "אחמ״שים");
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  await form.getByRole("button", { name: /^ערב/ }).click();
  await expect(
    shiftWorker(form).getByRole("option", { name: /^בן זמינות/ }),
  ).toBeDisabled();
  await form.getByRole("button", { name: /^בוקר/ }).click();
  await expect(
    shiftWorker(form).getByRole("option", { name: "בן זמינות", exact: true }),
  ).toBeEnabled();
});

test("weekly availability is optional, supports quick choices and keeps an empty selection editable on phone", async ({
  page,
}) => {
  await page.goto("/demo?view=department");
  await openMain(page, "צוות");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "עובד חדש", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("שם תצוגה", { exact: true })
    .fill("בדיקת זמינות בטלפון");
  await form.getByLabel("תפקיד / הכשרה").selectOption({ label: "אחמ״ש" });
  await expect(
    form.getByText("כל הימים והמשמרות", { exact: true }),
  ).toBeVisible();
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "בוקר בלבד", exact: true }).click();
  await form.getByRole("button", { name: "א׳–ה׳", exact: true }).click();
  await expect(
    form.getByLabel("בוקר ביום ראשון", { exact: true }),
  ).toBeChecked();
  await expect(
    form.getByLabel("ערב ביום ראשון", { exact: true }),
  ).not.toBeChecked();
  await expect(
    form.getByLabel("בוקר ביום שישי", { exact: true }),
  ).not.toBeChecked();
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "work/employee-weekly-mobile.png",
    fullPage: true,
  });
  await form.getByRole("button", { name: "ניקוי בחירה", exact: true }).click();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "יש לבחור לפחות משמרת אחת",
  );
  await expect(form.getByLabel("שם תצוגה", { exact: true })).toHaveValue(
    "בדיקת זמינות בטלפון",
  );
  await form.getByRole("button", { name: "הכול", exact: true }).click();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "בדיקת זמינות בטלפון" }),
  ).toBeVisible();
});

test("archived legacy week offers fresh creation and keeps both schedules recoverable", async ({
  page,
}) => {
  await page.goto("/demo?view=department");
  await expect(page.locator(".shift")).toHaveCount(7);
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
        .shift_assignments,
  );
  await clickWeekAction(page, "העברה לסל המחזור");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "העברה לסל המחזור", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(0);
  // Reproduce already-saved data from the version shown in the user's screenshot.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("myshift.demo.v1")!);
    saved.data.schedule_versions.forEach(
      (v: Record<string, unknown>) => delete v.archived_at,
    );
    localStorage.setItem("myshift.demo.v1", JSON.stringify(saved));
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "יצירת סידור", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "work/archived-create.png", fullPage: true });
  await clickWeekAction(page, "יצירה ללא שיבוץ");
  await expect(page.locator(".shift")).toHaveCount(21);
  await expect(page.locator(".shift.open")).toHaveCount(21);
  const all = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
        .shift_assignments,
  );
  for (const old of original) expect(all).toContainEqual(old);
  expect(all).toHaveLength(original.length + 21);
  await page.reload();
  await expect(page.locator(".shift.open")).toHaveCount(21);
  await clickWeekAction(page, "שחזור סידור");
  await expect(page.getByRole("dialog")).toContainText("הסידור הנוכחי יישמר");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ביטול", exact: true })
    .click();
  await expect(page.locator(".shift.open")).toHaveCount(21);
  await clickWeekAction(page, "שחזור סידור");
  await page.getByRole("button", { name: "אישור שחזור", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(7);
  await expect(page.locator(".shift.open")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".shift.open")).toHaveCount(0);
  const after = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
        .shift_assignments,
  );
  expect(after).toEqual(all);
});

test("notifications show only published schedules and clear dated change alerts with keyboard details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo?view=department");
  const bell = () =>
    page.locator(".topbar").getByRole("button", { name: /^התראות/ });
  await bell().click();
  await expect(page.locator(".schedule-notice")).toHaveCount(0);
  await expect(
    page.getByText("פרסומים ושינויים בסידורים שפורסמו", { exact: true }),
  ).toBeVisible();
  await openDepartment(page, "אחמ״שים");
  await clickWeekAction(page, "פרסום סידור");
  await bell().click();
  const published = page.getByRole("article", {
    name: "סידור פורסם",
    exact: true,
  });
  await expect(published).toHaveCount(1);
  await expect(published.locator("time")).toBeVisible();
  expect(
    Number.isFinite(
      Date.parse((await published.locator("time").getAttribute("datetime"))!),
    ),
  ).toBe(true);
  await published
    .getByRole("button", { name: "פירוט: סידור פורסם", exact: true })
    .click();
  await expect(
    published.getByRole("button", {
      name: "סגירת פירוט: סידור פורסם",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(published.locator(".notice-details")).toContainText(
    "7 משמרות בסידור",
  );
  await expect(published.getByText("חדש", { exact: true })).toHaveCount(0);
  await published
    .getByRole("button", { name: "לסידור השבוע", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(7);
  await page.getByRole("button", { name: "פתיחה לעריכה", exact: true }).click();
  await saveWorker(page, page.locator(".shift").first(), "");
  const noticesBeforePublish = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("myshift.demo.v1")!,
      ).data.notifications.filter((n: { kind?: string }) => n.kind).length,
  );
  expect(noticesBeforePublish).toBe(1);
  await clickWeekAction(page, "פרסום סידור");
  await bell().click();
  await expect(page.locator(".schedule-notice")).toHaveCount(2);
  await expect(page.locator(".notice-warning")).toHaveCount(1);
  const changed = page.getByRole("article", {
    name: "פורסם שינוי בסידור",
    exact: true,
  });
  const details = changed.getByRole("button", {
    name: "פירוט: פורסם שינוי בסידור",
    exact: true,
  });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(changed.locator(".notice-change-summary")).toContainText(
    "עודכנו 1",
  );
  await expect(
    changed.getByText("שינוי / חריגה", { exact: true }),
  ).toBeVisible();
  const warningColor = await changed.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const publicationColor = await published.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(warningColor).not.toBe(publicationColor);
  await page.screenshot({
    path: "work/schedule-notifications-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "work/schedule-notifications-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await bell().click();
  await expect(page.locator(".schedule-notice")).toHaveCount(2);
  await expect(
    page.getByText("ברוכים הבאים להדגמה", { exact: false }),
  ).toHaveCount(0);
});

test("weekly board makes drafts and missing schedules actionable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo");
  const roster = board(page);
  const pending = roster.getByRole("button", { name: /ממתינים לפרסום/ });
  await expect(pending).toContainText("4");
  await pending.click();
  await expect(pending).toHaveAttribute("aria-pressed", "true");
  await expect(roster.getByRole("rowheader")).toHaveCount(4);
  await pending.click();

  // Simulate a Sunday availability change after its employee was scheduled.
  await page.evaluate(() => {
    const key = "myshift.demo.v1";
    const saved = JSON.parse(localStorage.getItem(key)!);
    const employee = saved.data.employees.find(
      (row: { name: string }) => row.name === "דניאל לוי",
    );
    employee.weekly_availability = Array.from({ length: 7 }, (_, day) =>
      day === 0 ? ["evening"] : ["morning"],
    );
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  const conflicts = roster.getByRole("button", exact("1 שיבוצים לבדיקה"));
  await conflicts.click();
  await expect(roster.getByRole("rowheader")).toHaveCount(1);
  await expect(
    roster.getByRole("table").getByText("מחוץ לזמינות הקבועה", { exact: true }),
  ).toBeVisible();
  await departmentScheduleButton(roster, "אחמ״שים").click();
  await planning(page).getByRole("button", exact("בדיקת שיבוצים")).click();
  await expect(page.locator(".shift")).toHaveCount(1);
  await expect(page.locator(".shift")).toContainText("דניאל לוי");
  await page.getByRole("button", exact("חזרה לכל המחלקות")).click();
  await conflicts.click();

  await roster.getByRole("button", exact("השבוע הבא")).click();
  const supervisors = roster
    .getByRole("row")
    .filter({ has: departmentScheduleButton(page, "אחמ״שים") });
  await expect(supervisors).toContainText("טרם נוצר");
  await departmentScheduleButton(supervisors, "אחמ״שים").click();
  await expect(
    planning(page).getByRole("button", exact("יצירת סידור")),
  ).toBeVisible();
});

test("employee schedule shows only personal published shifts and the next shift", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-22T05:00:00Z"));
  await page.goto("/demo?view=department");
  await clickWeekAction(page, "פרסום סידור");
  await page
    .getByLabel("תצוגת הדגמה")
    .selectOption({ label: "עובד · דניאל לוי" });
  await expect(
    navigation(page).getByRole("button", exact("המשמרות שלי")),
  ).toBeVisible();
  await expect(page.getByText("המשמרת הקרובה", { exact: true })).toBeVisible();
  await expect(page.locator(".shift")).toHaveCount(3);
  await expect(page.locator(".shift-main")).toHaveCount(0);
  await expect(page.getByRole("button", exact("פתיחה לעריכה"))).toHaveCount(0);
  await expect(board(page)).toHaveCount(0);
  await page.getByRole("button", exact("שבוע הבא")).click();
  await expect(page.locator(".shift")).toHaveCount(0);
  await openMain(page, "הפרופיל שלי");
  await page.getByRole("button", exact("דיווח זמינות")).click();
  const availability = page.getByRole(
    "dialog",
    exact("דיווח זמינות · דניאל לוי"),
  );
  await availability.getByRole("button", exact("שמירה")).click();
  await expect(availability).toBeHidden();
  await expect(
    page.getByText("דניאל לוי · חלון זמינות", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", exact("עריכת זמינות"))).toBeVisible();
});

test("employee absence button handles sickness and vacation dates without changing recurring availability", async ({
  page,
}) => {
  // The dated absence fixtures below must remain in the visible week after reload.
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.goto("/demo?view=department");
  await openMain(page, "צוות");
  const employee = page.getByRole("row").filter({ hasText: "דניאל לוי" });
  await expect(page.getByText("טרם הוגשה זמינות", { exact: true })).toHaveCount(
    0,
  );
  await employee.getByRole("button", { name: "עריכה", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "בוקר בלבד", exact: true }).click();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await employee
    .getByRole("button", { name: "חופשות והיעדרויות", exact: true })
    .click();
  await expect(
    form.locator('input[type="time"], input[type="datetime-local"]'),
  ).toHaveCount(0);
  await expect(
    form
      .getByLabel("סוג ההיעדרות")
      .getByRole("option", { name: "זמין", exact: true }),
  ).toHaveCount(0);
  await form.getByLabel("סוג ההיעדרות").selectOption("sick");
  await form.getByLabel("מיום", { exact: true }).fill("2026-11-06");
  await form.getByLabel("עד יום (כולל)", { exact: true }).fill("2026-11-07");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "work/absence-form-mobile.png",
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "שמירת היעדרות", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const absence = page
    .locator(".absence-record")
    .filter({ hasText: "דניאל לוי" });
  await expect(absence).toContainText("מחלה");
  await expect(absence).toContainText("07.11.2026");
  await expect(employee).toContainText("בוקר בלבד · כל השבוע");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openMain(page, "צוות");
  await expect(absence).toContainText("מחלה");
  await page.getByLabel("סינון היעדרויות").selectOption("absent");
  await expect(page.locator(".employees-table tbody tr")).toHaveCount(1);
  await absence
    .getByRole("button", { name: "עריכת היעדרות", exact: true })
    .click();
  await form.getByLabel("סוג ההיעדרות").selectOption("vacation");
  await form.getByLabel("עד יום (כולל)", { exact: true }).fill("2026-11-08");
  await form
    .getByRole("button", { name: "שמירת היעדרות", exact: true })
    .click();
  await expect(absence).toContainText("חופשה");
  await expect(absence).toContainText("08.11.2026");
  await absence
    .getByRole("button", { name: "ביטול דיווח", exact: true })
    .click();
  await expect(absence).toHaveCount(0);
  await page.getByLabel("סינון היעדרויות").selectOption("");
  await expect(employee).toContainText("בוקר בלבד · כל השבוע");
  await expect(
    employee.getByText("היעדרות בשבוע הנבחר", { exact: true }),
  ).toHaveCount(0);
});

test("board publishes selected drafts and employees keep their last published shifts while editing", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-22T08:00:00Z"));
  await page.setViewportSize({ width: 472, height: 904 });
  await page.goto("/demo");
  const roster = board(page);
  const review = page.getByRole("dialog", exact("סקירה ופרסום סידור"));
  const openReview = () => roster.getByRole("button", { name: /^סקירה ופרסום/ }).click();
  const confirmReview = () => review.getByRole("button", { name: /^אישור ופרסום/ }).click();
  const identity = page.getByLabel("תצוגת הדגמה");

  await openReview();
  await expect(review.getByRole("checkbox", { name: /אחמ״שים/ })).toBeChecked();
  await expect(review.getByRole("checkbox", { name: /סיירים/ })).toBeChecked();
  await review.getByRole("checkbox", { name: /קבלה/ }).uncheck();
  await review.getByRole("checkbox", { name: /חניונים/ }).uncheck();
  await expect(review.getByRole("button", { name: /^אישור ופרסום/ })).toContainText("2");
  await confirmReview();
  await expect(review).toBeHidden();
  await expect(page.getByRole("status")).toContainText("הסידורים פורסמו");

  await identity.selectOption({ label: "עובד · דניאל לוי" });
  const personalShifts = page.locator(".shift");
  await expect(personalShifts.first()).toBeVisible();
  const originalCount = await personalShifts.count();
  await identity.selectOption({ label: "מנהל" });
  await departmentScheduleButton(roster, "אחמ״שים").click();
  await page.getByRole("button", exact("פתיחה לעריכה")).click();
  await saveWorker(page, page.locator(".shift").filter({ hasText: "דניאל לוי" }).first(), "");
  await identity.selectOption({ label: "עובד · דניאל לוי" });
  await expect(personalShifts).toHaveCount(originalCount);

  await identity.selectOption({ label: "מנהל" });
  const pendingAssignmentChange = roster.locator(".org-mobile").getByText("פינוי שיבוץ", { exact: true });
  await expect(pendingAssignmentChange).toBeVisible();
  await roster.getByRole("button", exact("השבוע הקודם")).click();
  await expect(pendingAssignmentChange).toHaveCount(0);
  await roster.getByRole("button", exact("השבוע הבא")).click();
  await expect(pendingAssignmentChange).toBeVisible();
  await openReview();
  for (const name of [/קבלה/, /חניונים/]) {
    await review.getByRole("checkbox", { name }).uncheck();
  }
  await review.locator("section").filter({ has: page.getByRole("checkbox", { name: /אחמ״שים/ }) })
    .locator("summary").click();
  await expect(review.getByText("פינוי שיבוץ", { exact: true })).toBeVisible();
  await expect(review.getByText(/דניאל לוי.*משמרת פנויה/)).toBeVisible();
  await confirmReview();
  await expect(review).toBeHidden();
  await expect(pendingAssignmentChange).toHaveCount(0);
  await identity.selectOption({ label: "עובד · דניאל לוי" });
  await expect(personalShifts).toHaveCount(originalCount - 1);
});
