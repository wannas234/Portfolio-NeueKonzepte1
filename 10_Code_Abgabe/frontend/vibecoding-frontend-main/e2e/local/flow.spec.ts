import { expect, test } from "@playwright/test";
import { expectPage, SEED_COURSE } from "./helpers";

// Signed in via the shared storage state. Each test opens its own page and is order independent.
// The goal is "the route works and renders a real page", not to re-test business logic.

test("dashboard renders inside the app shell", async ({ page }) => {
  await page.goto("/dashboard");
  await expectPage(page, /Hallo|Willkommen zurück/);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  for (const name of ["Übersicht", "KI-Assistent", "Kurse", "Kalender", "Unterlagen", "Noten"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
});

test("courses list leads into the seed course and its documents", async ({ page }) => {
  await page.goto("/courses");
  await expectPage(page, "Kurse");
  await page.getByRole("link", { name: new RegExp(SEED_COURSE.title) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/courses/${SEED_COURSE.id}`));
  await expectPage(page, SEED_COURSE.title);
});

test("course documents page renders with the seed document or an empty state", async ({ page }) => {
  await page.goto(`/courses/${SEED_COURSE.id}/documents`);
  await expectPage(page, "Unterlagen");
  await expect(page.getByRole("button", { name: /Datei hochladen|Dokument hochladen|Hochladen/i }).first()).toBeVisible();
});

test("global document library renders", async ({ page }) => {
  await page.goto("/documents");
  await expectPage(page, "Unterlagen");
});

test("calendar renders", async ({ page }) => {
  await page.goto("/calendar");
  await expectPage(page, /Kalender/);
});

test("grades render", async ({ page }) => {
  await page.goto("/grades");
  await expectPage(page, /Noten/);
});

test("profile renders the signed-in user", async ({ page }) => {
  await page.goto("/profile");
  await expectPage(page, "Profil");
});

test("the upload dialog states the supported formats and rejects an unsupported file early", async ({ page }) => {
  await page.goto(`/courses/${SEED_COURSE.id}/documents`);
  await page.getByRole("button", { name: /Datei hochladen|Dokument hochladen|Hochladen/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("PDF oder TXT, maximal 10 MiB");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "folien.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from("x") });
  await expect(dialog.getByRole("alert")).toContainText("nicht unterstützt");
});
