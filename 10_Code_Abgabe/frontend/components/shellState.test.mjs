import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { COMPACT_MEDIA_QUERY, effectiveCollapsed, isDrawerOpen } from "./shellState.ts";

test("the saved desktop collapse preference never applies in compact mode", () => {
  assert.equal(effectiveCollapsed(true, false), true);
  assert.equal(effectiveCollapsed(false, false), false);
  assert.equal(effectiveCollapsed(true, true), false);
  assert.equal(effectiveCollapsed(false, true), false);
});

test("the collapse preference and the drawer state do not affect each other", () => {
  const preference = true; // saved on desktop
  // Compact: the drawer works and the sidebar is never icon-only.
  assert.equal(effectiveCollapsed(preference, true), false);
  assert.equal(isDrawerOpen("/dashboard", "/dashboard", true), true);
  // Back on desktop: the saved preference applies again and no drawer is open.
  assert.equal(effectiveCollapsed(preference, false), true);
  assert.equal(isDrawerOpen("/dashboard", "/dashboard", false), false);
});

test("the drawer is only open in compact mode, on the path where it was opened", () => {
  assert.equal(isDrawerOpen("/dashboard", "/dashboard", true), true);
  assert.equal(isDrawerOpen("/dashboard", "/dashboard", false), false, "leaving compact mode closes it");
  assert.equal(isDrawerOpen(null, "/dashboard", true), false, "never opened");
});

test("a route change closes the drawer, and returning to the old path does not reopen it after closing", () => {
  assert.equal(isDrawerOpen("/dashboard", "/courses", true), false);
  assert.equal(isDrawerOpen("/dashboard", "/courses/abc/documents", true), false);
  // Closing resets the opened-at path to null, so the same path stays closed.
  assert.equal(isDrawerOpen(null, "/dashboard", true), false);
});

test("the compact breakpoint is one fixed media query that matches the stylesheet", async () => {
  assert.equal(COMPACT_MEDIA_QUERY, "(max-width: 900px)");
  const css = await readFile(new URL("./dashboardFrame.module.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.sidebar \{ position: fixed;/);
});

test("the shell keeps every navigation entry", async () => {
  const source = await readFile(new URL("./DashboardFrame.tsx", import.meta.url), "utf8");
  const hrefs = [...source.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}|${match[2]}`);
  assert.deepEqual(hrefs, [
    "/dashboard|Übersicht",
    "/assistant|KI-Assistent",
    "/courses|Kurse",
    "/calendar|Kalender",
    "/documents|Unterlagen",
    "/flashcards|Karteikarten",
    "/grades|Noten",
    "/profile|Profil",
  ]);
});

test("the sidebar no longer reserves a column in compact mode", async () => {
  const css = await readFile(new URL("./dashboardFrame.module.css", import.meta.url), "utf8");
  const compact = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (prefers-reduced-motion"));
  assert.match(compact, /\.sidebar \{[^}]*position: fixed/);
  assert.match(compact, /translateX\(-100%\)/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/, "no global horizontal clipping");
});
