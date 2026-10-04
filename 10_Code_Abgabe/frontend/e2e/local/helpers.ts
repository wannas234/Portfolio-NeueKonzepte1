import { expect, type Page } from "@playwright/test";

// Local seed credentials documented in ../backend/supabase/seed.sql. They exist only in a local
// Supabase stack; playwright.local.config.ts refuses to run against a non-loopback Supabase.
export const SEED_USER = { email: "anna@example.com", password: "password123" };

// Seed course of the same user (fixed UUIDs, see seed.sql).
export const SEED_COURSE = { id: "90000000-0000-0000-0000-000000000001", title: "Biologie" };

export async function login(page: Page, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("E-Mail").fill(SEED_USER.email);
  await page.getByLabel("Passwort", { exact: true }).fill(SEED_USER.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

/** A route rendered a real page: its heading is visible and no error boundary took over. */
export async function expectPage(page: Page, heading: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await expect(page.getByText(/Application error|Something went wrong|This page couldn.t load/i)).toHaveCount(0);
}
