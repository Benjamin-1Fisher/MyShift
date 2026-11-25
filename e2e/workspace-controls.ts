import { expect, type Locator, type Page } from "@playwright/test";

export const exact = (name: string) => ({ name, exact: true });

export const navigation = (page: Page) => page.getByRole("navigation").first();
export const board = (page: Page) =>
  page.getByRole("region", exact("לוח שבועי לכל המחלקות"));
export const planning = (page: Page) =>
  page.getByRole("region", exact("ניהול הסידור"));
const more = (panel: Locator) =>
  panel
    .locator("summary")
    .filter({ hasText: /^\s*עוד\s*$/ })
    .first();

export async function openMore(panel: Locator) {
  const summary = more(panel);
  await expect(summary).toBeVisible();
  if (!(await summary.evaluate((node) => node.closest("details")?.open))) {
    await summary.click();
  }
}

export async function clickWeekAction(page: Page, name: string) {
  const panel = planning(page);
  await expect(panel).toBeVisible();
  const action = panel.getByRole("button", exact(name));
  if (!(await action.isVisible())) await openMore(panel);
  await action.click();
}

export async function openMain(page: Page, name: string) {
  const menu = page.getByRole("button", exact("תפריט"));
  if (await menu.isVisible()) await menu.click();
  await navigation(page).getByRole("button", exact(name)).click();
}

export async function openDepartment(page: Page, name: string) {
  await openMain(page, "סידור עבודה");
  await board(page).getByRole("button", exact(name)).click();
}

export async function chooseDepartment(
  page: Page,
  current: string,
  target: string,
) {
  await page.getByRole("button", exact("מחלקה · " + current)).click();
  await page
    .getByRole("group", exact("מחלקה"))
    .getByRole("button", exact(target))
    .click();
}
