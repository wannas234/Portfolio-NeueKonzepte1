import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnalysisError,
  analysisErrorMessage,
  defaultEventKind,
  parseAnalysisResult,
  parseDecision,
  suggestionFormValues,
  timezoneMismatch,
  toAnalysisErrorCode,
} from "./materialAnalysis.ts";

test("only documented backend codes are kept", () => {
  assert.equal(toAnalysisErrorCode("SOURCES_NOT_READY"), "SOURCES_NOT_READY");
  assert.equal(toAnalysisErrorCode("ANALYSIS_TIMEOUT"), "ANALYSIS_TIMEOUT");
  for (const value of [undefined, null, 7, "", "sources_not_ready", "BRAND_NEW"]) {
    assert.equal(toAnalysisErrorCode(value), "UNKNOWN");
  }
});

test("every error code produces a German message without leaking the code", () => {
  const codes = [
    "UNAUTHENTICATED", "SOURCES_NOT_READY", "SOURCE_CHANGED", "REQUEST_TOO_LARGE",
    "SOURCE_LIMIT_EXCEEDED", "ANALYSIS_RATE_LIMITED", "ANALYSIS_TIMEOUT", "ANSWERS_NOT_CONFIGURED",
    "ANALYSIS_UNAVAILABLE", "DECISION_CONFLICT", "ANALYSIS_EXPIRED", "REQUEST_CONFLICT",
    "TARGET_NOT_FOUND", "ANALYSIS_NOT_FOUND", "ITEM_NOT_FOUND", "NETWORK_ERROR", "UNKNOWN",
  ];
  for (const code of codes) {
    const message = analysisErrorMessage(new AnalysisError(code));
    assert.ok(message.length > 10, `${code} has no usable message`);
    assert.ok(!message.includes(code), `${code} leaks the raw code`);
  }
  assert.ok(analysisErrorMessage("not an error").length > 10);
});

test("the backend's coarse kind maps to a neutral calendar kind, never a guessed one", () => {
  assert.equal(defaultEventKind("deadline"), "deadline");
  // "event" darf nicht zu "exam" o. Ä. geraten werden.
  assert.equal(defaultEventKind("event"), "other");
});

test("a suggestion without a time becomes an all-day proposal instead of an invented hour", () => {
  const base = {
    id: "a", title: "Mathematikprüfung", description: null, page: 2, quote: "…",
    reviewRequired: false, issues: [], kind: "event",
    date: "2026-11-12", time: null, endDate: null, endTime: null,
    timezone: "Europe/Berlin", location: null, submissionChannel: null,
  };
  const allDay = suggestionFormValues(base);
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.date, "2026-11-12");

  const timed = suggestionFormValues({ ...base, time: "09:00:00", endTime: "11:30:00" });
  assert.equal(timed.allDay, false);
  // Sekunden gehören nicht in ein <input type="time">.
  assert.equal(timed.time, "09:00");
  assert.equal(timed.endTime, "11:30");
});

test("a differing timezone is surfaced, a matching one stays silent", () => {
  const suggestion = { timezone: "Europe/Berlin" };
  assert.equal(timezoneMismatch(suggestion, "Europe/Berlin"), null);
  assert.equal(timezoneMismatch({ timezone: null }, "Europe/Berlin"), null);
  const warning = timezoneMismatch(suggestion, "America/New_York");
  assert.ok(warning?.includes("Europe/Berlin"));
  assert.ok(warning?.includes("America/New_York"));
});

test("a result payload without the required fields is rejected", () => {
  assert.throws(() => parseAnalysisResult({}), AnalysisError);
  assert.throws(() => parseAnalysisResult({ analysis_id: "a" }), AnalysisError);
  assert.throws(() => parseAnalysisResult({ analysis_id: "a", status: "weird" }), AnalysisError);
});

test("only calendar_entry items are read; other item types are skipped, not guessed", () => {
  const result = parseAnalysisResult({
    analysis_id: "an-1",
    material_id: "mat-1",
    status: "completed",
    items: [
      {
        id: "i1", type: "calendar_entry", title: "Prüfung", description: "Lineare Funktionen",
        source: { page: 2, quote: "Am 12. November …" },
        review: { required: true, issues: [{ code: "missing_year", message: "Jahr fehlt." }] },
        data: { kind: "deadline", date: "2026-11-12", time: "09:00:00", end_date: null, end_time: null, timezone: "Europe/Berlin", location: null, submission_channel: "Moodle" },
      },
      { id: "i2", type: "future_type", title: "Etwas Neues" },
      { type: "calendar_entry", title: "Ohne id" },
    ],
    warnings: [{ code: "w", message: "Hinweis" }, { code: "x" }],
    error_code: null,
    decisions: [
      { item_id: "i1", status: "accepted", calendar_event_id: "ev-1" },
      { item_id: "i9", status: "nonsense", calendar_event_id: null },
    ],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "i1");
  assert.equal(result.items[0].kind, "deadline");
  assert.equal(result.items[0].reviewRequired, true);
  assert.equal(result.items[0].issues[0].message, "Jahr fehlt.");
  assert.equal(result.items[0].submissionChannel, "Moodle");
  // Ein Hinweis ohne message ist unbrauchbar und fliegt raus.
  assert.equal(result.warnings.length, 1);
  // Eine Entscheidung mit unbekanntem Status wird nicht als gültig durchgereicht.
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].calendarEventId, "ev-1");
});

test("empty items on a completed analysis is a valid result, not an error", () => {
  const result = parseAnalysisResult({ analysis_id: "a", status: "completed", items: [] });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.items, []);
});

test("a failed analysis keeps its public error code for the UI", () => {
  const result = parseAnalysisResult({ analysis_id: "a", status: "failed", error_code: "ANALYSIS_TIMEOUT" });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "ANALYSIS_TIMEOUT");
});

test("a decision response must name the item and a known status", () => {
  assert.deepEqual(parseDecision({ item_id: "i1", status: "dismissed", calendar_event_id: null }), {
    itemId: "i1", status: "dismissed", calendarEventId: null,
  });
  assert.throws(() => parseDecision({ status: "accepted" }), AnalysisError);
  assert.throws(() => parseDecision({ item_id: "i1", status: "maybe" }), AnalysisError);
});
