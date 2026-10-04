import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFlashcardDraft,
  deleteDraft,
  DraftConflictError,
  fitsDraftLimits,
  loadDraft,
  parseFlashcardDraft,
  saveDraft,
  singleSourceDocumentId,
  sourceMaterialOf,
} from "./learning-drafts.ts";

// A chainable fake of the query builder that records every call and resolves with `result`.
function fakeClient(result) {
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
      rpc: (name, args) => { calls.push(["rpc", name, args]); return builder; },
    },
  };
}

const draft = { jobId: "job-1", title: "Woche 1", cards: [{ id: "a", question: "F", answer: "A", keep: true }] };

test("a draft is read for one source material and kind", async () => {
  const { calls, client } = fakeClient({ data: { payload: draft, revision: 7 }, error: null });
  assert.deepEqual(await loadDraft(client, "m1", "flashcards"), { payload: draft, revision: 7 });
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "learning_drafts"]);
  assert.deepEqual(calls.filter(([m]) => m === "eq"), [["eq", "source_material_id", "m1"], ["eq", "kind", "flashcards"]]);
  assert.equal(await loadDraft(fakeClient({ data: null, error: null }).client, "m1", "flashcards"), null);
  await assert.rejects(loadDraft(fakeClient({ data: null, error: new Error("boom") }).client, "m1", "summary"), /boom/);
});

test("saving sends the expected revision and returns the new one", async () => {
  const { calls, client } = fakeClient({ data: 8, error: null });
  assert.equal(await saveDraft(client, "m1", "flashcards", draft, 7), 8);
  assert.deepEqual(calls[0], ["rpc", "save_learning_draft", {
    p_source_material: "m1", p_kind: "flashcards", p_payload: draft, p_expected_revision: 7,
  }]);
});

test("a write from another tab surfaces as a conflict, other errors stay as they are", async () => {
  await assert.rejects(
    saveDraft(fakeClient({ data: null, error: { code: "40001", message: "DRAFT_CONFLICT" } }).client, "m1", "flashcards", draft, 1),
    DraftConflictError
  );
  await assert.rejects(
    saveDraft(fakeClient({ data: null, error: { code: "P0001", message: "DRAFT_CONFLICT" } }).client, "m1", "flashcards", draft, 1),
    DraftConflictError
  );
  await assert.rejects(
    saveDraft(fakeClient({ data: null, error: { code: "22023", message: "INVALID_DRAFT" } }).client, "m1", "flashcards", draft, 1),
    (error) => !(error instanceof DraftConflictError) && error.message === "INVALID_DRAFT"
  );
});

test("deleting sends a null payload and leaves another tab's newer draft alone", async () => {
  const { calls, client } = fakeClient({ data: 0, error: null });
  await deleteDraft(client, "m1", "flashcards", 8);
  assert.deepEqual(calls[0], ["rpc", "save_learning_draft", {
    p_source_material: "m1", p_kind: "flashcards", p_payload: null, p_expected_revision: 8,
  }]);
  await deleteDraft(fakeClient({ data: null, error: { code: "40001", message: "DRAFT_CONFLICT" } }).client, "m1", "flashcards", 8);
  await assert.rejects(deleteDraft(fakeClient({ data: null, error: { code: "42501", message: "SOURCE_NOT_FOUND" } }).client, "m1", "flashcards", 8));
});

test("a source document resolves to its material", async () => {
  const { calls, client } = fakeClient({ data: { material_id: "m1" }, error: null });
  assert.equal(await sourceMaterialOf(client, "d1"), "m1");
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "source_documents"]);
  assert.equal(await sourceMaterialOf(fakeClient({ data: null, error: null }).client, "d1"), null);
});

test("only content from exactly one known document has a place for a draft", () => {
  assert.equal(singleSourceDocumentId([{ documentId: "d1" }, { documentId: "d1" }]), "d1");
  assert.equal(singleSourceDocumentId([{ documentId: "d1" }, { documentId: "d2" }]), null);
  assert.equal(singleSourceDocumentId([{ documentId: "d1" }, { documentId: null }]), null);
  assert.equal(singleSourceDocumentId([{ documentId: null }]), null);
  assert.equal(singleSourceDocumentId([]), null);
});

test("a stored draft is only taken over for the same job and in the expected shape", () => {
  assert.deepEqual(parseFlashcardDraft(draft, "job-1"), draft);
  assert.equal(parseFlashcardDraft(draft, "job-2"), null);
  assert.equal(parseFlashcardDraft(null, "job-1"), null);
  assert.equal(parseFlashcardDraft({ ...draft, title: 3 }, "job-1"), null);
  assert.equal(parseFlashcardDraft({ ...draft, cards: [{ id: "a", question: "F" }] }, "job-1"), null);
});

test("draft edits are applied to the job's cards by id, unknown cards stay untouched", () => {
  const cards = [
    { id: "a", question: "alt", answer: "alt", keep: true, sourceIds: ["s1"] },
    { id: "b", question: "bleibt", answer: "bleibt", keep: true, sourceIds: [] },
  ];
  const edited = { ...draft, cards: [{ id: "a", question: "neu", answer: "neu", keep: false }, { id: "x", question: "?", answer: "?", keep: true }] };
  assert.deepEqual(applyFlashcardDraft(cards, edited), [
    { id: "a", question: "neu", answer: "neu", keep: false, sourceIds: ["s1"] },
    { id: "b", question: "bleibt", answer: "bleibt", keep: true, sourceIds: [] },
  ]);
});

test("drafts beyond the backend limits are not sent", () => {
  assert.equal(fitsDraftLimits(draft), true);
  assert.equal(fitsDraftLimits({ ...draft, cards: [{ id: "a", question: "x".repeat(1001), answer: "A", keep: true }] }), false);
  assert.equal(fitsDraftLimits({ ...draft, cards: [{ id: "a", question: "F", answer: "x".repeat(4001), keep: true }] }), false);
  assert.equal(fitsDraftLimits({ ...draft, cards: Array.from({ length: 301 }, (_, i) => ({ id: String(i), question: "F", answer: "A", keep: true })) }), false);
});
