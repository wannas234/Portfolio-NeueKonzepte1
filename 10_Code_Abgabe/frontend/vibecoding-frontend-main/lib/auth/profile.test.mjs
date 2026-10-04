import assert from "node:assert/strict";
import { test } from "node:test";
import { loadLoginProfile, profileInitial, registrationProfileMetadata } from "./profile.ts";

test("profile initials use the first trimmed Unicode character", () => {
  assert.equal(profileInitial("  anna"), "A");
  assert.equal(profileInitial("ömer"), "Ö");
  assert.equal(profileInitial("🧠 Lernen"), "🧠");
  assert.equal(profileInitial("   "), "L");
});

test("registration maps the UI name to Auth display_name metadata", () => {
  assert.deepEqual(registrationProfileMetadata("Anna"), { display_name: "Anna" });
});

const noWait = async () => {};

test("a transient profile failure after login can recover without another sign-in", async () => {
  let calls = 0;
  const result = await loadLoginProfile(async () => {
    calls++;
    return calls === 1
      ? { data: null, error: { code: "" }, status: 503 }
      : { data: { id: "profile" }, error: null, status: 200 };
  }, noWait);
  assert.equal(result, "ready");
  assert.equal(calls, 2);
});

test("missing profiles, expired sessions and schema/permission errors are distinct and not retried", async () => {
  for (const [response, expected] of [
    [{ data: null, error: null, status: 200 }, "missing"],
    [{ data: null, error: {}, status: 401 }, "unauthorized"],
    [{ data: null, error: { code: "42703" }, status: 400 }, "configuration"],
    [{ data: null, error: {}, status: 403 }, "configuration"],
  ]) {
    let calls = 0;
    assert.equal(await loadLoginProfile(async () => { calls++; return response; }, noWait), expected);
    assert.equal(calls, 1);
  }
});

test("network and server failures have a bounded retry and support a later manual retry", async () => {
  for (const status of [0, 408, 429, 500, 503]) {
    let calls = 0;
    assert.equal(await loadLoginProfile(async () => {
      calls++;
      return { data: null, error: {}, status };
    }, noWait), "unavailable");
    assert.equal(calls, 2);
  }
  assert.equal(await loadLoginProfile(async () => { throw new TypeError("fetch failed"); }, noWait), "unavailable");
  assert.equal(await loadLoginProfile(async () => ({ data: { id: "profile" }, error: null, status: 200 }), noWait), "ready");
});
