import assert from "node:assert/strict";
import { test } from "node:test";
import { countDueFlashcards, getProfileName, listRecentDocuments, listUnfinishedDocuments } from "./dashboard.ts";

// A chainable fake of the query builder that records every call and resolves with `result`.
function fakeClient(result, user = { id: "user-1" }) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_, method) {
      if (method === "then") return (resolve) => resolve(result);
      return (...args) => { calls.push([method, ...args]); return builder; };
    },
  });
  return {
    calls,
    client: {
      from: (table) => { calls.push(["from", table]); return builder; },
      auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no session") }) },
    },
  };
}

const ready = { processing_status: "ready", error_code: null, indexing_status: "ready", indexing_error: null };
const file = { original_filename: "Vorlesung 1.pdf", mime_type: "application/pdf" };

test("recent documents read the user's source materials, newest first, with a limit", async () => {
  const { calls, client } = fakeClient({
    data: [{ id: "m1", course_id: "c1", file_id: "f1", created_at: "2026-09-25T10:00:00Z", files: file, source_documents: ready }],
    error: null,
  });
  const documents = await listRecentDocuments(client, 4);
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "materials"]);
  assert.deepEqual(calls.find(([m]) => m === "eq"), ["eq", "type", "source_document"]);
  assert.deepEqual(calls.find(([m]) => m === "order"), ["order", "created_at", { ascending: false }]);
  assert.deepEqual(calls.find(([m]) => m === "limit"), ["limit", 4]);
  assert.deepEqual(documents, [{
    materialId: "m1", courseId: "c1", fileId: "f1", name: "Vorlesung 1.pdf", mimeType: "application/pdf",
    addedAt: "2026-09-25T10:00:00Z",
    state: { processingStatus: "ready", errorCode: null, indexingStatus: "ready", indexingError: null },
  }]);
});

test("recent documents skip rows that have no file or no source document to link to", async () => {
  const { client } = fakeClient({
    data: [
      { id: "m1", course_id: "c1", file_id: null, created_at: "x", files: null, source_documents: ready },
      { id: "m2", course_id: "c1", file_id: "f2", created_at: "x", files: file, source_documents: null },
      { id: "m3", course_id: "c1", file_id: "f3", created_at: "x", files: null, source_documents: ready },
    ],
    error: null,
  });
  assert.deepEqual(await listRecentDocuments(client), []);
});

test("unfinished documents filter on any stage that is not ready and map the nested material", async () => {
  const failed = { processing_status: "failed", error_code: "UNSUPPORTED_FORMAT", indexing_status: "pending", indexing_error: null };
  const { calls, client } = fakeClient({
    data: [{ ...failed, materials: { id: "m1", course_id: "c1", file_id: "f1", created_at: "2026-09-24T08:00:00Z", files: file } }],
    error: null,
  });
  const documents = await listUnfinishedDocuments(client);
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "source_documents"]);
  assert.deepEqual(calls.find(([m]) => m === "or"), ["or", "processing_status.neq.ready,indexing_status.neq.ready"]);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].fileId, "f1");
  assert.equal(documents[0].state.errorCode, "UNSUPPORTED_FORMAT");
});

test("database errors are propagated instead of returning an empty list", async () => {
  const failure = new Error("permission denied");
  await assert.rejects(listRecentDocuments(fakeClient({ data: null, error: failure }).client), (error) => error === failure);
  await assert.rejects(listUnfinishedDocuments(fakeClient({ data: null, error: failure }).client), (error) => error === failure);
  await assert.rejects(getProfileName(fakeClient({ data: null, error: failure }).client), (error) => error === failure);
});

test("the profile name comes only from the signed-in user's profile row", async () => {
  const { calls, client } = fakeClient({ data: { name: "Anna" }, error: null });
  assert.equal(await getProfileName(client), "Anna");
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "profiles"]);
  assert.deepEqual(calls.find(([m]) => m === "eq"), ["eq", "user_id", "user-1"]);
  assert.equal(await getProfileName(fakeClient({ data: null, error: null }).client), null);
  await assert.rejects(getProfileName(fakeClient({ data: null, error: null }, null).client));
});

test("due flashcards are counted from the user's own progress rows that are due now", async () => {
  const { calls, client } = fakeClient({ count: 7, data: null, error: null });
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(await countDueFlashcards(client, now), 7);
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "flashcard_progress"]);
  assert.deepEqual(calls.find(([m]) => m === "select"), ["select", "card_id", { count: "exact", head: true }]);
  assert.deepEqual(calls.find(([m]) => m === "lte"), ["lte", "due_at", "2026-10-04T12:00:00.000Z"]);
});

test("a missing count means no due flashcards, and errors are propagated", async () => {
  assert.equal(await countDueFlashcards(fakeClient({ count: null, data: null, error: null }).client), 0);
  await assert.rejects(countDueFlashcards(fakeClient({ count: null, data: null, error: new Error("boom") }).client), /boom/);
});
