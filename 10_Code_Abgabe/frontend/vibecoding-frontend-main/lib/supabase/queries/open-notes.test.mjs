import assert from "node:assert/strict";
import { test } from "node:test";
import { listOpenNotes, openNoteHref } from "./open-notes.ts";

// A chainable fake of the query builder that records every call and resolves with `result`.
function fakeClient(result) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_, method) {
      if (method === "then") return (resolve) => resolve(result);
      return (...args) => { calls.push([method, ...args]); return builder; };
    },
  });
  return { calls, client: { from: (table) => { calls.push(["from", table]); return builder; } } };
}

const material = { course_id: "c1", file_id: "f1", title: "Vorlesung 3" };
const noteRow = { id: "n1", page_number: 4, kind: "note", body: " Nachlesen ", quote: null, created_at: "2026-10-04T10:00:00Z", materials: material };

test("open notes are read newest first with a limit and the total count", async () => {
  const { calls, client } = fakeClient({ data: [noteRow], count: 9, error: null });
  const notes = await listOpenNotes(client, { limit: 3 });
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "document_notes"]);
  assert.deepEqual(calls.filter(([m]) => m === "eq"), [["eq", "status", "open"]]);
  assert.deepEqual(calls.find(([m]) => m === "order"), ["order", "created_at", { ascending: false }]);
  assert.deepEqual(calls.find(([m]) => m === "limit"), ["limit", 3]);
  assert.equal(notes.total, 9);
  assert.deepEqual(notes.items, [{
    id: "n1", courseId: "c1", fileId: "f1", materialTitle: "Vorlesung 3", pageNumber: 4,
    kind: "note", text: "Nachlesen", createdAt: "2026-10-04T10:00:00Z",
  }]);
});

test("a course filter limits the notes to that course's materials", async () => {
  const { calls, client } = fakeClient({ data: [], count: 0, error: null });
  assert.deepEqual(await listOpenNotes(client, { courseId: "c1" }), { items: [], total: 0 });
  assert.deepEqual(calls.filter(([m]) => m === "eq"), [["eq", "status", "open"], ["eq", "materials.course_id", "c1"]]);
  assert.deepEqual(calls.find(([m]) => m === "limit"), ["limit", 5]);
});

test("a highlight without a comment shows its quote, and a missing count falls back to the rows", async () => {
  const highlight = { ...noteRow, id: "n2", kind: "highlight", body: "", quote: "Satz von Bayes" };
  const notes = await listOpenNotes(fakeClient({ data: [highlight], count: null, error: null }).client);
  assert.equal(notes.items[0].kind, "highlight");
  assert.equal(notes.items[0].text, "Satz von Bayes");
  assert.equal(notes.total, 1);
});

test("errors are propagated instead of an empty list", async () => {
  await assert.rejects(listOpenNotes(fakeClient({ data: null, count: null, error: new Error("boom") }).client), /boom/);
});

test("an open note links to the notes tab of its document, or to the course without a file", () => {
  assert.equal(openNoteHref({ courseId: "c1", fileId: "f1" }), "/courses/c1/documents/f1?tab=notes");
  assert.equal(openNoteHref({ courseId: "c1", fileId: null }), "/courses/c1");
});
