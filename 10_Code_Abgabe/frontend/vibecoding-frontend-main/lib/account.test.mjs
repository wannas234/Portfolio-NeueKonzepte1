import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AccountError,
  accountErrorMessage,
  DELETE_CONFIRMATION,
  exportFileName,
  toAccountErrorCode,
} from "./account.ts";

test("the confirmation word matches the backend exactly", () => {
  // Das Backend vergleicht wortgenau; eine Abweichung hier würde jede Löschung blocken.
  assert.equal(DELETE_CONFIRMATION, "LÖSCHEN");
});

test("only documented backend codes survive", () => {
  assert.equal(toAccountErrorCode("INVALID_PASSWORD"), "INVALID_PASSWORD");
  assert.equal(toAccountErrorCode("STRIPE_ERROR"), "STRIPE_ERROR");
  for (const value of [undefined, null, 7, "", "invalid_password", "SOMETHING_NEW"]) {
    assert.equal(toAccountErrorCode(value), "UNKNOWN");
  }
});

test("every error code produces a German message without leaking the code", () => {
  const codes = [
    "UNAUTHENTICATED", "RATE_LIMITED", "INVALID_REQUEST", "CONFIRMATION_REQUIRED",
    "INVALID_PASSWORD", "PASSWORD_REQUIRED", "STRIPE_ERROR", "STORAGE_ERROR",
    "DATABASE_ERROR", "DELETE_FAILED", "CONFIGURATION_ERROR", "SERVICE_UNAVAILABLE",
    "NETWORK_ERROR", "UNKNOWN",
  ];
  for (const code of codes) {
    const message = accountErrorMessage(new AccountError(code));
    assert.ok(message.length > 10, `${code} has no usable message`);
    assert.ok(!message.includes(code), `${code} leaks the raw code`);
  }
  assert.ok(accountErrorMessage("kein Fehlerobjekt").length > 10);
});

test("the two states that destroy nothing say so explicitly", () => {
  // Wichtig für das Vertrauen: nach diesen Fehlern besteht das Konto weiter.
  assert.match(accountErrorMessage(new AccountError("STRIPE_ERROR")), /nichts gelöscht/i);
  assert.match(accountErrorMessage(new AccountError("STORAGE_ERROR")), /besteht weiterhin/i);
});

test("the rate limit hint uses the retry window the backend reported", () => {
  assert.match(accountErrorMessage(new AccountError("RATE_LIMITED", 7200)), /2 Stunden/);
  assert.match(accountErrorMessage(new AccountError("RATE_LIMITED", 600)), /einer Stunde/);
  // Ohne Angabe keine erfundene Zahl.
  const vague = accountErrorMessage(new AccountError("RATE_LIMITED", null));
  assert.match(vague, /später/);
  assert.ok(!/\d/.test(vague));
});

test("the export file name follows the backend naming", () => {
  assert.equal(exportFileName(new Date("2026-10-04T12:00:00Z")), "universe-export-2026-10-04.json");
  assert.match(exportFileName(new Date("kaputt")), /^universe-export-\d{4}-\d{2}-\d{2}\.json$/);
});
