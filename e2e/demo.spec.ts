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
  await expect(page.locator(".shift")).toHaveCount(7);
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
    .getByLabel("אתר", { exact: true })
    .selectOption({ label: "מתחם צפון" });
  await dialog.getByRole("button", { name: /לילה/ }).click();
  await expect(dialog.getByLabel("עובד במשמרת")).toHaveValue("");
  await dialog
    .getByRole("button", { name: "שמירת משמרת", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".shift")).toHaveCount(15);
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
  await expect(page.locator(".shift")).toHaveCount(14);
  await page
    .getByRole("button", { name: "ביטול הפעולה האחרונה", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(15);
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
  await expect(page.locator(".shift")).toHaveCount(15);
  await expect(page.getByText("פורסם", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.locator(".shift")).toHaveCount(15);
  await page.getByRole("button", { name: /עוזר AI/ }).click();
  await expect(page.getByLabel("בקשה לעוזר")).toBeDisabled();
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

test("delete is recoverable after reload and restore is draft with the same shifts", async ({
  page,
}) => {
  await page.goto("/demo");
  await expect(page.locator(".shift")).toHaveCount(7);
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
  await expect(page.getByRole("dialog")).toContainText("7");
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(page.locator(".shift")).toHaveCount(7);
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

for (const button of ["יצירת סידור חדש", "יצירה ללא שיבוץ"]) {
  test(`${button} creates morning, evening and night every day and persists readable cards`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/demo");
    await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator(".shift")).toHaveCount(21);
    for (const day of await page.locator(".day-column").all()) {
      await expect(day.locator(".shift")).toHaveCount(3);
      for (const hours of ["07:00 – 15:00", "15:00 – 23:00", "23:00 – 07:00"])
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
    ).toBeGreaterThanOrEqual(17);
    expect(
      await card
        .locator(".shift-time")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(15);
    expect(
      await card
        .locator("small")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(14);
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
    await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
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
  await page.goto("/demo");
  await expect(page.locator("p[role=alert]")).toContainText("השינוי לא נשמר");
});

test("phone planning is readable without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
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
      .getByRole("button", { name: "שמירת משמרת", exact: true }),
  ).toBeVisible();
});

test("employee form saves Friday-night availability and respects it in automatic and manual staffing", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
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
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
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
  await page.getByRole("button", { name: "סידורי עבודה", exact: true }).click();
  await page.getByRole("button", { name: "שבוע הבא", exact: true }).click();
  await page
    .getByRole("button", { name: "יצירת סידור חדש", exact: true })
    .click();
  await expect(page.locator(".shift")).toHaveCount(21);
  const benShifts = page
    .locator(".shift")
    .filter({ has: page.locator("strong").filter({ hasText: "בן זמינות" }) });
  await expect(benShifts).toHaveCount(1);
  await expect(benShifts.locator(".shift-time")).toHaveText("23:00 – 07:00");
  await expect(
    page
      .locator(".day-column")
      .filter({ has: benShifts })
      .locator(".day-header"),
  ).toContainText("שישי");
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
  await row.getByRole("button", { name: "עריכה", exact: true }).click();
  await form
    .locator("summary")
    .filter({ hasText: "זמינות קבועה למשמרות" })
    .click();
  await form.getByRole("button", { name: "בוקר בלבד", exact: true }).click();
  await form.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(row).toContainText("בוקר בלבד · כל השבוע");
  await page.getByRole("button", { name: "הוספת משמרת", exact: true }).click();
  await form.getByRole("button", { name: /^ערב/ }).click();
  await expect(
    form.getByLabel("עובד במשמרת").getByRole("option", { name: /^בן זמינות/ }),
  ).toBeDisabled();
  await form.getByRole("button", { name: /^בוקר/ }).click();
  await expect(
    form
      .getByLabel("עובד במשמרת")
      .getByRole("option", { name: "בן זמינות", exact: true }),
  ).toBeEnabled();
});

test("weekly availability is optional, supports quick choices and keeps an empty selection editable on phone", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "עובדים", exact: true }).click();
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
  await page.goto("/demo");
  await expect(page.locator(".shift")).toHaveCount(7);
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("myshift.demo.v1")!).data
        .shift_assignments,
  );
  await page.getByRole("button", { name: "מחיקת סידור", exact: true }).click();
  await page
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
    page.getByRole("button", { name: "יצירת סידור חדש", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "יצירה ללא שיבוץ", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "work/archived-create.png", fullPage: true });
  await page
    .getByRole("button", { name: "יצירה ללא שיבוץ", exact: true })
    .click();
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
  await page.getByText("סידורים שנמחקו (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "שחזור סידור זה", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("הסידור הנוכחי יישמר");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ביטול", exact: true })
    .click();
  await expect(page.locator(".shift.open")).toHaveCount(21);
  await page
    .getByRole("button", { name: "שחזור סידור זה", exact: true })
    .click();
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
