import { expect, test } from "@playwright/test";
import { expectPage } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const path of ["/dashboard", "/courses", "/calendar", "/documents", "/grades"]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test("the navigation drawer opens, navigates and closes", async ({ page }) => {
  await page.goto("/dashboard");
  const open = page.getByRole("button", { name: "Navigation öffnen" });
  await expect(open).toHaveAttribute("aria-expanded", "false");

  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav).toBeVisible();

  // Close with the explicit control.
  await page.getByRole("button", { name: "Navigation schließen" }).click();
  await expect(open).toHaveAttribute("aria-expanded", "false");

  // Escape also closes it.
  await open.click();
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(open).toHaveAttribute("aria-expanded", "false");

  // A route can be opened from the drawer, which closes afterwards.
  await open.click();
  await nav.getByRole("link", { name: "Kurse" }).click();
  await expect(page).toHaveURL(/\/courses/);
  await expectPage(page, "Kurse");
  await expect(page.getByRole("button", { name: "Navigation öffnen" })).toHaveAttribute("aria-expanded", "false");
});
