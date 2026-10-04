import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryableSummaryError,
  isSummaryJobFinished,
  parseSummaryJob,
  parseSummaryResult,
  stripSourceMarkers,
  SummaryError,
  summaryErrorMessage,
  summaryProgress,
  toSummaryErrorCode,
} from "./summaryGeneration.ts";

test("only documented backend codes are kept, everything else becomes UNKNOWN", () => {
  assert.equal(toSummaryErrorCode("NO_SOURCES"), "NO_SOURCES");
  assert.equal(toSummaryErrorCode("SOURCES_NOT_READY"), "SOURCES_NOT_READY");
  for (const value of [undefined, null, 42, "", "no_sources", "SOMETHING_NEW"]) {
    assert.equal(toSummaryErrorCode(value), "UNKNOWN");
  }
});

test("every error code produces a German message and never leaks the raw code", () => {
  const codes = [
    "UNAUTHENTICATED", "NO_SOURCES", "SOURCES_NOT_READY", "SOURCE_LIMIT_EXCEEDED",
    "REQUEST_TOO_LARGE", "SUMMARY_RATE_LIMITED", "SOURCE_CHANGED", "BUDGET_EXCEEDED",
    "SUMMARY_PROCESSING_FAILED", "SUMMARIES_NOT_CONFIGURED", "SUMMARIES_UNAVAILABLE",
    "RESULT_DELETED", "NEW_REQUEST_REQUIRED", "REQUEST_CONFLICT", "TARGET_NOT_FOUND",
    "SUMMARY_NOT_FOUND", "NETWORK_ERROR", "INVALID_RESPONSE", "UNKNOWN",
  ];
  for (const code of codes) {
    const message = summaryErrorMessage(new SummaryError(code));
    assert.ok(message.length > 10, `${code} has no usable message`);
    assert.ok(!message.includes(code), `${code} leaks the raw code into the UI`);
    assert.ok(!message.includes("_"), `${code} looks like a technical identifier`);
  }
  // Auch etwas, das gar kein SummaryError ist, bekommt einen Text statt eines Absturzes.
  assert.ok(summaryErrorMessage(new Error("boom")).length > 10);
});

test("only the two documented retryable failures allow reusing the same job", () => {
  assert.equal(isRetryableSummaryError("SUMMARY_PROCESSING_FAILED"), true);
  assert.equal(isRetryableSummaryError("SUMMARIES_UNAVAILABLE"), true);
  for (const code of ["NO_SOURCES", "BUDGET_EXCEEDED", "SOURCE_CHANGED", "RESULT_DELETED"]) {
    assert.equal(isRetryableSummaryError(code), false, `${code} must not offer a retry`);
  }
});

test("progress is indeterminate until the backend reports a total step count", () => {
  const base = { jobId: "j", status: "processing", summaryId: null, errorCode: null };
  const early = summaryProgress({ ...base, phase: "sections", completedSteps: 0, totalSteps: 0 });
  assert.equal(early.indeterminate, true);
  assert.equal(early.percent, null);
  assert.equal(early.label, "Abschnitte werden gelesen");

  const half = summaryProgress({ ...base, phase: "document", completedSteps: 2, totalSteps: 4 });
  assert.equal(half.indeterminate, false);
  assert.equal(half.percent, 50);

  // Mehr erledigte als geplante Schritte dürfen nicht über 100 % laufen.
  const over = summaryProgress({ ...base, phase: "course", completedSteps: 9, totalSteps: 4 });
  assert.equal(over.percent, 100);
});

test("a job counts as finished only in a terminal state", () => {
  const base = { jobId: "j", phase: "queued", completedSteps: 0, totalSteps: 0, summaryId: null, errorCode: null };
  assert.equal(isSummaryJobFinished({ ...base, status: "completed" }), true);
  assert.equal(isSummaryJobFinished({ ...base, status: "failed" }), true);
  assert.equal(isSummaryJobFinished({ ...base, status: "queued" }), false);
  assert.equal(isSummaryJobFinished({ ...base, status: "processing" }), false);
});

test("source markers are removed without leaving stray spaces", () => {
  assert.equal(stripSourceMarkers("Der Satz ist wichtig [S1]."), "Der Satz ist wichtig.");
  assert.equal(stripSourceMarkers("Erst [S1] dann [S12] Ende"), "Erst dann Ende");
  assert.equal(stripSourceMarkers("Ohne Marker"), "Ohne Marker");
  // Keine Markersyntax: bleibt unangetastet.
  assert.equal(stripSourceMarkers("Array[S] und [1]"), "Array[S] und [1]");
});

test("a job payload without the required fields is rejected instead of guessed", () => {
  assert.throws(() => parseSummaryJob({}), SummaryError);
  assert.throws(() => parseSummaryJob({ job_id: "j" }), SummaryError);
  assert.throws(() => parseSummaryJob({ job_id: "j", status: "weird" }), SummaryError);
  assert.throws(() => parseSummaryJob(null), SummaryError);
});

test("a job payload is normalised and unknown phases fall back to queued", () => {
  const job = parseSummaryJob({
    job_id: "job-1", status: "processing", phase: "document",
    completed_steps: 3, total_steps: 5, summary_id: null, error_code: null,
  });
  assert.deepEqual(job, {
    jobId: "job-1", status: "processing", phase: "document",
    completedSteps: 3, totalSteps: 5, summaryId: null, errorCode: null,
  });
  assert.equal(parseSummaryJob({ job_id: "j", status: "queued", phase: "nonsense" }).phase, "queued");
  assert.equal(parseSummaryJob({ job_id: "j", status: "queued" }).totalSteps, 0);
});

test("a result payload keeps only well-formed sections and sources", () => {
  const result = parseSummaryResult({
    summary_id: "sum-1",
    material_id: "mat-1",
    created_at: "2026-10-03T10:00:00Z",
    is_stale: true,
    content: {
      text: "Überblick [S1]",
      sections: [
        { heading: "Überblick", text: "Inhalt [S1]", source_ids: ["S1"] },
        { heading: "Kaputt", source_ids: ["S1"] },
        { text: "Ohne Überschrift", source_ids: "nope" },
      ],
      sources: [
        { id: "S1", source_document_id: "doc-1", material_id: "mat-2", title: "Vorlesung", page: 1 },
        { id: "S2", page: null },
        { source_document_id: "doc-9" },
      ],
    },
  });

  assert.equal(result.summaryId, "sum-1");
  assert.equal(result.isStale, true);
  // Der Abschnitt ohne text fliegt raus, der ohne heading bleibt mit leerer Überschrift.
  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.sections[0], { heading: "Überblick", text: "Inhalt [S1]", sourceIds: ["S1"] });
  assert.deepEqual(result.sections[1], { heading: "", text: "Ohne Überschrift", sourceIds: [] });
  // Die Quelle ohne id fliegt raus, fehlende Felder bekommen sichere Standardwerte.
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1].title, "Unbenannte Unterlage");
  assert.equal(result.sources[1].page, null);
});

test("is_stale is only true when the backend says so", () => {
  const base = { summary_id: "s", content: { text: "x", sections: [], sources: [] } };
  assert.equal(parseSummaryResult(base).isStale, false);
  assert.equal(parseSummaryResult({ ...base, is_stale: "true" }).isStale, false);
  assert.equal(parseSummaryResult({ ...base, is_stale: true }).isStale, true);
  assert.throws(() => parseSummaryResult({ content: {} }), SummaryError);
});
