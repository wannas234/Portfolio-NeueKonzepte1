import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authErrorMessage,
  isProtectedPath,
  safeAuthRedirect,
  validateDisplayName,
  validateLoginPassword,
  validatePasswordReset,
  validateRegistrationPassword,
} from "./validation.ts";

test("display names are trimmed and checked as Unicode code points", () => {
  assert.deepEqual(validateDisplayName("  Anna  "), { valid: true, value: "Anna" });
  assert.equal(validateDisplayName("   ").valid, false);
  assert.equal(validateDisplayName("ä".repeat(60)).valid, true);
  assert.equal(validateDisplayName("🧠".repeat(61)).valid, false);
});

test("password reset validates strength and equality without modifying either value", () => {
  assert.equal(validatePasswordReset("1234567", "1234567"), "Das Passwort muss mindestens 8 Zeichen lang sein.");
  assert.equal(validatePasswordReset("password", "password!"), "Die beiden Passwörter stimmen nicht überein.");
  assert.equal(validatePasswordReset(" password ", " password "), null);
});

test("registration and login apply different password rules without changing input", () => {
  assert.equal(validateRegistrationPassword("1234567"), "Das Passwort muss mindestens 8 Zeichen lang sein.");
  assert.equal(validateRegistrationPassword(" 123456 "), null);
  assert.equal(validateLoginPassword("x"), null);
  assert.equal(validateLoginPassword(""), "Bitte gib dein Passwort ein.");
});

test("redirects are restricted to protected internal application paths", () => {
  assert.equal(isProtectedPath("/assistant"), true);
  assert.equal(isProtectedPath("/assistant-example"), false);
  assert.equal(isProtectedPath("/billing"), true);
  assert.equal(isProtectedPath("/billing/success"), true);
  assert.equal(isProtectedPath("/billing/cancel"), true);
  assert.equal(isProtectedPath("/billing-example"), false);
  assert.equal(safeAuthRedirect("/assistant?conversation=example"), "/assistant?conversation=example");
  assert.equal(safeAuthRedirect("/courses/example?tab=files"), "/courses/example?tab=files");
  assert.equal(safeAuthRedirect("/profile"), "/profile");
  assert.equal(safeAuthRedirect("/profile/preferences?tab=account"), "/profile/preferences?tab=account");
  for (const path of [
    "/dashboard",
    "/assistant",
    "/courses/abc/flashcards",
    "/calendar",
    "/documents",
    "/flashcards",
    "/summaries",
    "/grades",
    "/profile",
    "/billing",
    "/billing/success",
  ]) {
    assert.equal(safeAuthRedirect(path), path);
  }
  for (const unsafe of ["https://evil.example", "//evil.example", "/login", "/auth/callback", null]) {
    assert.equal(safeAuthRedirect(unsafe), "/dashboard");
  }
});

test("auth errors are mapped without exposing backend messages", () => {
  assert.equal(authErrorMessage({ code: "invalid_credentials", message: "secret detail" }, "login"), "E-Mail-Adresse oder Passwort ist nicht korrekt.");
  assert.match(authErrorMessage({ status: 429 }, "register"), /Zu viele Versuche/);
});
