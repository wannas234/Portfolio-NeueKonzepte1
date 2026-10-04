import { expect, test } from "@playwright/test";

test("landing page loads and links to login and registration", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Registrieren" })).toHaveAttribute("href", "/register");
});

test("login page loads with labelled fields", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Schön, dass.*du wieder hier bist/ })).toBeVisible();
  await expect(page.getByLabel("E-Mail")).toBeVisible();
  await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Passwort anzeigen" })).toBeVisible();
});

test("register page loads with labelled fields", async ({ page }) => {
  const response = await page.goto("/register");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Konto\s*erstellen/ })).toBeVisible();
  await expect(page.getByLabel("Anzeigename")).toBeVisible();
  await expect(page.getByLabel("E-Mail")).toBeVisible();
  await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
});

test("forgot-password page loads with a labelled field", async ({ page }) => {
  const response = await page.goto("/forgot-password");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Passwort\s*vergessen/ })).toBeVisible();
  await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
});

test("the password visibility toggle works from the keyboard", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Passwort", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Passwort anzeigen" }).focus();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Passwort ausblenden" })).toBeVisible();
});
