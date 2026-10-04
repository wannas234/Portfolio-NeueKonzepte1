import assert from "node:assert/strict";
import { test } from "node:test";
import { retryDocument, retryFailureCode, retryFailureMessage } from "./document-retry.ts";

const DOCUMENT_ID = "11111111-2222-4333-8444-555555555555";

function recordingClient(result = { data: {}, error: null }) {
  const calls = [];
  return { calls, client: { rpc: async (name, args) => { calls.push({ name, args }); return result; } } };
}

test("processing retry calls exactly retry_document_processing with the document id", async () => {
  const { calls, client } = recordingClient();
  await retryDocument(client, DOCUMENT_ID, "processing");
  assert.deepEqual(calls, [{ name: "retry_document_processing", args: { p_document_id: DOCUMENT_ID } }]);
});

test("indexing retry calls exactly retry_document_indexing with the document id", async () => {
  const { calls, client } = recordingClient();
  await retryDocument(client, DOCUMENT_ID, "indexing");
  assert.deepEqual(calls, [{ name: "retry_document_indexing", args: { p_document_id: DOCUMENT_ID } }]);
});

test("a retry only uses the RPC: no table access, so no status column is written", async () => {
  const client = {
    rpc: async () => ({ data: {}, error: null }),
    from: () => assert.fail("retry must not touch tables"),
  };
  await retryDocument(client, DOCUMENT_ID, "processing");
});

test("backend errors are propagated as known codes", async () => {
  const notFound = recordingClient({ data: null, error: { message: "DOCUMENT_NOT_FOUND", code: "P0002" } });
  await assert.rejects(retryDocument(notFound.client, DOCUMENT_ID, "processing"), (error) => error.message === "DOCUMENT_NOT_FOUND");
  const notReady = recordingClient({ data: null, error: { message: "FILE_NOT_READY", code: "55000" } });
  await assert.rejects(retryDocument(notReady.client, DOCUMENT_ID, "processing"), (error) => error.message === "FILE_NOT_READY");
  const other = recordingClient({ data: null, error: { message: "connection refused to db.internal", code: "08006" } });
  await assert.rejects(retryDocument(other.client, DOCUMENT_ID, "indexing"), (error) => error.message === "RETRY_FAILED");
});

test("failure codes map to user messages without leaking technical details", () => {
  assert.equal(retryFailureCode({ message: "x", code: "P0002" }), "DOCUMENT_NOT_FOUND");
  assert.equal(retryFailureCode({ message: "x", code: "55000" }), "FILE_NOT_READY");
  assert.equal(retryFailureCode({ message: "connection refused to db.internal" }), "RETRY_FAILED");
  for (const code of ["DOCUMENT_NOT_FOUND", "FILE_NOT_READY", "RETRY_FAILED", "unknown"]) {
    const message = retryFailureMessage(code);
    assert.ok(message.length > 0 && !message.includes("db.internal") && !message.includes("_"));
  }
});
