import { expect, test } from "@playwright/test";
import { expectPage, login } from "./helpers";

// Every test here signs in itself, so logging out never affects other projects' session.

test("wrong credentials show a friendly error and stay on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("anna@example.com");
  await page.getByLabel("Passwort", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("E-Mail-Adresse oder Passwort ist nicht korrekt.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("login reaches the dashboard and logout closes the protected area again", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();

  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Kurse" }).click();
  await expect(page).toHaveURL(/\/courses/);
  await expectPage(page, "Kurse");

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/login\?next=%2Fcourses/);
});

test("an authenticated visit to login returns to the app, and a hostile next never leaves it", async ({ page, baseURL }) => {
  await login(page, "//evil.example");
  await expect(page).toHaveURL(/\/dashboard/);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);

  await page.goto("/login?next=https%3A%2F%2Fevil.example");
  await expect(page).toHaveURL(/\/dashboard/);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("a valid protected next target is honoured after login", async ({ page }) => {
  await login(page, "/calendar");
  await expect(page).toHaveURL(/\/calendar/);
  await expectPage(page, /Termine/);
});
