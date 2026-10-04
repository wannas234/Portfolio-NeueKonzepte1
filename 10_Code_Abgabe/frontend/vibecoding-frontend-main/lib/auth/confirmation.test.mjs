import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPendingConfirmation,
  expiredAuthCookie,
  parseEmailOtpType,
  parsePendingConfirmation,
  requestHasTrustedOrigin,
  trustedOrigin,
} from "./confirmation.ts";

test("only configured confirmation, recovery and e-mail change OTP types are accepted", () => {
  assert.equal(parseEmailOtpType("email"), "email");
  assert.equal(parseEmailOtpType("recovery"), "recovery");
  assert.equal(parseEmailOtpType("email_change"), "email_change");
  for (const value of [null, "signup", "invite", "magiclink", "email_change_new"]) {
    assert.equal(parseEmailOtpType(value), null);
  }
});

test("pending confirmations round-trip without accepting malformed tokens", () => {
  const token = "a".repeat(64);
  const encoded = createPendingConfirmation(token, "recovery");
  assert.deepEqual(parsePendingConfirmation(encoded ?? undefined), {
    tokenHash: token,
    type: "recovery",
  });
  assert.deepEqual(parsePendingConfirmation(createPendingConfirmation(token, "email_change") ?? undefined), {
    tokenHash: token,
    type: "email_change",
  });
  assert.equal(createPendingConfirmation("short", "email"), null);
  assert.equal(parsePendingConfirmation("email.not valid"), null);
});

test("server redirects and POST requests use one trusted origin", () => {
  assert.equal(trustedOrigin("https://app.example", "http://internal:3000"), "https://app.example");
  assert.equal(trustedOrigin(undefined, "http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(requestHasTrustedOrigin("https://app.example", "https://app.example"), true);
  assert.equal(requestHasTrustedOrigin("https://evil.example", "https://app.example"), false);
  assert.throws(() => trustedOrigin("https://app.example/path", "http://internal"));
});

test("non-HTTP configured origins cannot become auth redirect targets", () => {
  for (const origin of ["ftp://app.example", "javascript:alert(1)", "https://user:password@app.example", "https://app.example/?next=evil"]) {
    assert.throws(() => trustedOrigin(origin, "http://internal:3000"));
  }
});

test("confirmation and recovery cookies expire on their original /auth path", async () => {
  const { default: cookieModule } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
  for (const name of ["lernapp_pending_confirmation", "lernapp_recovery_session"]) {
    const headers = new Headers();
    const cookies = new cookieModule.ResponseCookies(headers);
    cookies.set(name, "", expiredAuthCookie);
    const header = headers.get("set-cookie");
    assert.match(header, /Path=\/auth(?:;|$)/);
    assert.match(header, /Max-Age=0/);
    assert.match(header, /Expires=Thu, 01 Jan 1970/);
  }
});
