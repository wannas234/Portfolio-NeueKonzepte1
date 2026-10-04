import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatBytes,
  formatResetDate,
  USAGE_LABELS,
  usageRatio,
  usageRemaining,
  usageTone,
  parseUsage,
} from "./usage-format.ts";

test("every usage kind has a German label", () => {
  for (const [kind, label] of Object.entries(USAGE_LABELS)) {
    assert.ok(label.length > 2, kind);
    assert.ok(!label.includes("_"), `${kind} shows a technical identifier`);
  }
});

test("a locked quota counts as full, not as empty", () => {
  // Grenze 0 heißt "im Tarif gesperrt". Als 0 % dargestellt sähe das aus wie viel Luft.
  assert.equal(usageRatio(0, 0), 1);
  assert.equal(usageTone(0, 0), "full");
});

test("the ratio stays within 0 and 1 even when the server reports an overrun", () => {
  assert.equal(usageRatio(0, 10), 0);
  assert.equal(usageRatio(5, 10), 0.5);
  assert.equal(usageRatio(10, 10), 1);
  assert.equal(usageRatio(30, 10), 1);
  assert.equal(usageRatio(-5, 10), 0);
});

test("the tone warns from 80 percent and is full once the limit is reached", () => {
  assert.equal(usageTone(0, 10), "ok");
  assert.equal(usageTone(7, 10), "ok");
  assert.equal(usageTone(8, 10), "warn");
  assert.equal(usageTone(9, 10), "warn");
  assert.equal(usageTone(10, 10), "full");
  assert.equal(usageTone(11, 10), "full");
});

test("remaining units are never negative", () => {
  assert.equal(usageRemaining(3, 10), 7);
  assert.equal(usageRemaining(10, 10), 0);
  assert.equal(usageRemaining(14, 10), 0);
});

test("byte sizes are formatted in German with a sensible unit", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-1), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "2 KB");
  // Ab MB eine Nachkommastelle, mit deutschem Dezimalkomma.
  assert.equal(formatBytes(1024 * 1024 * 1.5), "1,5 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1,0 GB");
  assert.ok(formatBytes(Number.NaN).startsWith("0"));
});

test("the reset date is readable, and an unusable value yields null", () => {
  assert.equal(formatResetDate("2026-11-01T00:00:00Z")?.includes("November"), true);
  assert.equal(formatResetDate(null), null);
  assert.equal(formatResetDate("kein Datum"), null);
});

test("a usage payload is normalised and unknown kinds are ignored", () => {
  const usage = parseUsage({
    plan: "free",
    grace_until: null,
    resets_at: "2026-11-01T00:00:00Z",
    usage: {
      chat: { used: 12, limit: 100, pro_limit: 2000 },
      upload: { used: 20, limit: 20, pro_limit: 500 },
      zukunft: { used: 1, limit: 2, pro_limit: 3 },
    },
    storage: { used_bytes: 1024, limit_bytes: 2048, pro_limit_bytes: 4096 },
  });

  assert.equal(usage.plan, "free");
  // Nur bekannte Kontingente, in fester Reihenfolge aus USAGE_LABELS.
  assert.deepEqual(usage.entries.map((entry) => entry.kind), ["chat", "upload"]);
  assert.equal(usage.entries[0].label, USAGE_LABELS.chat);
  assert.equal(usage.entries[1].proLimit, 500);
  assert.equal(usage.storage.usedBytes, 1024);
});

test("a broken payload yields safe values instead of throwing", () => {
  const empty = parseUsage(null);
  assert.equal(empty.plan, "free");
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.resetsAt, null);
  assert.equal(empty.storage.limitBytes, 0);

  // Negative oder nicht-numerische Zähler werden zu 0, nicht zu NaN.
  const odd = parseUsage({ plan: "pro", usage: { chat: { used: -3, limit: "100", pro_limit: null } } });
  assert.equal(odd.plan, "pro");
  assert.equal(odd.entries[0].used, 0);
  assert.equal(odd.entries[0].limit, 0);
});

test("only the exact plan value pro counts as pro", () => {
  assert.equal(parseUsage({ plan: "pro" }).plan, "pro");
  assert.equal(parseUsage({ plan: "PRO" }).plan, "free");
  assert.equal(parseUsage({ plan: "trialing" }).plan, "free");
});
