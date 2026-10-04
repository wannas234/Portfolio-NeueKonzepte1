import { expect, test } from "@playwright/test";

const PROTECTED = ["/dashboard", "/assistant", "/courses", "/calendar", "/documents", "/grades", "/profile", "/billing", "/billing/success", "/billing/cancel"];

for (const path of PROTECTED) {
  test(`${path} without a session redirects to login and keeps the target`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(path);
    await expect(page.getByRole("heading", { name: /Schön, dass.*du wieder hier bist/ })).toBeVisible();
  });
}

test("nested protected routes redirect too, and the redirect target stays a local path", async ({ page, baseURL }) => {
  await page.goto("/courses/abc/documents?x=//evil.example");
  await expect(page).toHaveURL(/\/login\?/);
  const url = new URL(page.url());
  expect(url.origin).toBe(new URL(baseURL!).origin);
  const next = url.searchParams.get("next") ?? "";
  expect(next.startsWith("/") && !next.startsWith("//")).toBe(true);
});

for (const hostile of ["https://evil.example/phish", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
  test(`a hostile next parameter (${hostile}) never navigates away from the app`, async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent(hostile)}`);
    await expect(page.getByRole("heading", { name: /Schön, dass.*du wieder hier bist/ })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });
}
