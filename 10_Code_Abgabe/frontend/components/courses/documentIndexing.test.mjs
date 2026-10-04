// Run with Node 22+: node --test components/courses/documentIndexing.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeIndexingProgress, retryStage } from "./documentIndexing.ts";

const extracted = { processingStatus: "ready", errorCode: null };

test("pending upload verification reports progress before any document row exists", () => {
  const progress = describeIndexingProgress("pending", null);
  assert.equal(progress.tone, "active");
  assert.equal(progress.inProgress, true);
  assert.ok(progress.percent > 0 && progress.percent < 100);
});

test("ready file without a source document keeps polling", () => {
  const progress = describeIndexingProgress("ready", null);
  assert.equal(progress.inProgress, true);
  assert.equal(progress.tone, "pending");
});

test("uploaded is shown as waiting for processing", () => {
  const progress = describeIndexingProgress("ready", {
    processingStatus: "uploaded",
    errorCode: null,
    indexingStatus: "pending",
    indexingError: null,
  });
  assert.equal(progress.label, "Hochgeladen – Verarbeitung ausstehend");
  assert.equal(progress.inProgress, true);
});

test("percent increases monotonically along the pipeline", () => {
  const stages = [
    describeIndexingProgress("pending", null).percent,
    describeIndexingProgress("ready", null).percent,
    describeIndexingProgress("ready", { ...extracted, processingStatus: "uploaded", indexingStatus: "pending", indexingError: null }).percent,
    describeIndexingProgress("ready", { ...extracted, processingStatus: "processing", indexingStatus: "pending", indexingError: null }).percent,
    describeIndexingProgress("ready", { ...extracted, indexingStatus: "pending", indexingError: null }).percent,
    describeIndexingProgress("ready", { ...extracted, indexingStatus: "processing", indexingError: null }).percent,
    describeIndexingProgress("ready", { ...extracted, indexingStatus: "ready", indexingError: null }).percent,
  ];
  for (let i = 1; i < stages.length; i += 1) {
    assert.ok(stages[i] > stages[i - 1], `stage ${i} must exceed stage ${i - 1}`);
  }
  assert.equal(stages.at(-1), 100);
});

test("only a fully indexed document reaches the ready tone", () => {
  const progress = describeIndexingProgress("ready", {
    ...extracted,
    indexingStatus: "ready",
    indexingError: null,
  });
  assert.equal(progress.tone, "ready");
  assert.equal(progress.percent, 100);
  assert.equal(progress.inProgress, false);
});

test("extracted text alone is not ready", () => {
  const progress = describeIndexingProgress("ready", {
    ...extracted,
    indexingStatus: "processing",
    indexingError: null,
  });
  assert.notEqual(progress.tone, "ready");
  assert.ok(progress.percent < 100);
});

test("processing failure explains the public error code", () => {
  const progress = describeIndexingProgress("ready", {
    processingStatus: "failed",
    errorCode: "UNSUPPORTED_FORMAT",
    indexingStatus: "pending",
    indexingError: null,
  });
  assert.equal(progress.tone, "failed");
  assert.equal(progress.inProgress, false);
  assert.match(progress.detail, /Format/);
});

test("unknown processing error codes fall back to the raw code", () => {
  const progress = describeIndexingProgress("ready", {
    processingStatus: "failed",
    errorCode: "SOMETHING_NEW",
    indexingStatus: "pending",
    indexingError: null,
  });
  assert.equal(progress.detail, "SOMETHING_NEW");
});

test("indexing failure is reported separately from extraction", () => {
  const progress = describeIndexingProgress("ready", {
    ...extracted,
    indexingStatus: "failed",
    indexingError: "INDEXING_TIMEOUT",
  });
  assert.equal(progress.tone, "failed");
  assert.equal(progress.label, "Indexierung fehlgeschlagen");
  assert.match(progress.detail, /zu lange/);
});

test("file level states short-circuit the document pipeline", () => {
  assert.equal(describeIndexingProgress("failed", null).tone, "failed");
  assert.equal(describeIndexingProgress("deleting", null).inProgress, false);

  const legacy = describeIndexingProgress("unverified", null);
  assert.equal(legacy.tone, "pending");
  assert.equal(legacy.inProgress, false);
});

const state = (patch) => ({ processingStatus: "ready", errorCode: null, indexingStatus: "ready", indexingError: null, ...patch });

test("retry is offered for transient processing and indexing failures", () => {
  for (const errorCode of ["PROCESSING_FAILED", "PROCESSING_TIMEOUT"]) {
    assert.equal(retryStage("ready", state({ processingStatus: "failed", errorCode, indexingStatus: "pending" })), "processing");
  }
  assert.equal(retryStage("ready", state({ indexingStatus: "failed", indexingError: "INDEXING_TIMEOUT" })), "indexing");
});

test("retry is not offered for permanent failures such as unsupported formats", () => {
  for (const errorCode of ["UNSUPPORTED_FORMAT", "INVALID_DOCUMENT", "SOURCE_DELETED"]) {
    assert.equal(retryStage("ready", state({ processingStatus: "failed", errorCode, indexingStatus: "pending" })), null);
  }
  assert.equal(retryStage("ready", state({ indexingStatus: "failed", indexingError: "INVALID_INDEXING_INPUT" })), null);
});

test("retry is not offered while unfinished, when ready, or without a source document", () => {
  for (const patch of [
    { processingStatus: "uploaded", indexingStatus: "pending" },
    { processingStatus: "processing", indexingStatus: "pending" },
    { indexingStatus: "pending" },
    { indexingStatus: "processing" },
    {},
  ]) assert.equal(retryStage("ready", state(patch)), null);
  assert.equal(retryStage("ready", null), null);
});

test("retry is only offered for confirmed files, never for failed uploads", () => {
  const failed = state({ processingStatus: "failed", errorCode: "PROCESSING_TIMEOUT", indexingStatus: "pending" });
  for (const status of ["pending", "failed", "unverified", "deleting"]) assert.equal(retryStage(status, failed), null);
});
