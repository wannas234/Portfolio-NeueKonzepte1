import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTE_BODY_MAX, NOTE_QUOTE_MAX, sortNotesForReview, validateNote } from "./note-format.ts";

test("a note needs text, a highlight needs the quoted passage", () => {
  assert.deepEqual(validateNote("note", "Wichtig für die Klausur", ""), { ok: true });
  assert.equal(validateNote("note", "   ", "").ok, false);

  // Bei einer Markierung ist der Kommentar optional, das Zitat nicht.
  assert.deepEqual(validateNote("highlight", "", "Der markierte Satz"), { ok: true });
  assert.equal(validateNote("highlight", "Kommentar", "   ").ok, false);
});

test("the backend length limits are enforced before sending", () => {
  assert.equal(validateNote("note", "a".repeat(NOTE_BODY_MAX), "").ok, true);
  assert.equal(validateNote("note", "a".repeat(NOTE_BODY_MAX + 1), "").ok, false);
  assert.equal(validateNote("highlight", "", "q".repeat(NOTE_QUOTE_MAX)).ok, true);
  assert.equal(validateNote("highlight", "", "q".repeat(NOTE_QUOTE_MAX + 1)).ok, false);
});

test("every rejection explains itself in German without a technical identifier", () => {
  const cases = [
    validateNote("note", "", ""),
    validateNote("note", "a".repeat(NOTE_BODY_MAX + 1), ""),
    validateNote("highlight", "", ""),
    validateNote("highlight", "", "q".repeat(NOTE_QUOTE_MAX + 1)),
  ];
  for (const result of cases) {
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 10);
    assert.ok(!/_/.test(result.message));
  }
});

test("open notes come first, then page order, then age", () => {
  const notes = [
    { id: "c", status: "resolved", pageNumber: 1, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", status: "open", pageNumber: 5, createdAt: "2026-01-01T00:00:00Z" },
    { id: "a", status: "open", pageNumber: 2, createdAt: "2026-01-02T00:00:00Z" },
    { id: "d", status: "open", pageNumber: 2, createdAt: "2026-01-01T00:00:00Z" },
  ];
  assert.deepEqual(sortNotesForReview(notes).map((note) => note.id), ["d", "a", "b", "c"]);
});

test("sorting does not mutate the given array", () => {
  const notes = [
    { id: "x", status: "resolved", pageNumber: 9, createdAt: "2026-01-01T00:00:00Z" },
    { id: "y", status: "open", pageNumber: 1, createdAt: "2026-01-01T00:00:00Z" },
  ];
  const order = notes.map((note) => note.id);
  sortNotesForReview(notes);
  assert.deepEqual(notes.map((note) => note.id), order);
});
