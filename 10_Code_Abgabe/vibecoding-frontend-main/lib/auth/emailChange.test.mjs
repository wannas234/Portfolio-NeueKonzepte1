import assert from "node:assert/strict";
import { test } from "node:test";
import { emailChangeErrorMessage, emailChangeOutcome, validateNewEmail } from "./emailChange.ts";

test("a new e-mail address is trimmed and must be a different, well-formed address", () => {
  assert.deepEqual(validateNewEmail("  neu@uni.de ", "alt@uni.de"), { valid: true, value: "neu@uni.de" });
  assert.equal(validateNewEmail("", "alt@uni.de").valid, false);
  assert.equal(validateNewEmail("keine-adresse", "alt@uni.de").valid, false);
  assert.equal(validateNewEmail("a b@uni.de", "alt@uni.de").valid, false);
  assert.equal(validateNewEmail(`${"a".repeat(250)}@uni.de`, "alt@uni.de").valid, false);
  assert.equal(validateNewEmail("ALT@uni.de", "alt@uni.de").valid, false);
});

test("e-mail change errors map to messages without leaking backend text", () => {
  assert.match(emailChangeErrorMessage({ status: 429 }), /Zu viele Versuche/);
  assert.match(emailChangeErrorMessage({ code: "over_email_send_rate_limit" }), /Zu viele Versuche/);
  assert.match(emailChangeErrorMessage({ code: "email_exists" }), /bereits verwendet/);
  assert.match(emailChangeErrorMessage({ code: "email_address_invalid" }), /keine gültige/);
  assert.match(emailChangeErrorMessage({ status: 401 }), /Sitzung ist abgelaufen/);
  assert.match(emailChangeErrorMessage({ code: "unexpected_failure" }), /später erneut/);
});

test("the first of the two confirmation links leaves the change pending", () => {
  assert.equal(emailChangeOutcome(null), "pending");
  assert.equal(emailChangeOutcome(undefined), "pending");
  assert.equal(emailChangeOutcome({ id: "user-1" }), "changed");
});
