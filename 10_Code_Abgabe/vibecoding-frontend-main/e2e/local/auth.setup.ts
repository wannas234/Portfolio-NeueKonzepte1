import { expect, test as setup } from "@playwright/test";
import { login } from "./helpers";

// One login shared by the authenticated project (saved as storage state, git-ignored).
setup("sign in as the seed user", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
