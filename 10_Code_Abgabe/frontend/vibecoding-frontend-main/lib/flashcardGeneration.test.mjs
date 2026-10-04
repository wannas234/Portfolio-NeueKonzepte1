import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FlashcardGenerationError,
  flashcardErrorMessage,
  flashcardProgress,
  isCardValid,
  isFlashcardJobRunning,
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_REQUESTED_CARDS,
  parseFlashcardJob,
  parseSelectableDocuments,
  toFlashcardErrorCode,
  validateDeckSave,
} from "./flashcardGeneration.ts";

const job = (overrides) => ({
  id: "j", status: "processing", phase: "analyze", errorCode: null, materialId: null,
  requestedCount: null, analyzed: 0, total: 0, estimatedCount: 0, generated: 0,
  cards: [], sources: [], ...overrides,
});

test("only documented backend codes survive", () => {
  assert.equal(toFlashcardErrorCode("RATE_LIMITED"), "RATE_LIMITED");
  assert.equal(toFlashcardErrorCode("SOURCE_CHANGED"), "SOURCE_CHANGED");
  for (const value of [undefined, null, 1, "", "rate_limited", "NEW_CODE"]) {
    assert.equal(toFlashcardErrorCode(value), "UNKNOWN");
  }
});

test("every error code produces a German message without leaking the code", () => {
  const codes = [
    "UNAUTHENTICATED", "SOURCES_NOT_READY", "SOURCE_CHANGED", "SOURCE_LIMIT_EXCEEDED",
    "REQUEST_TOO_LARGE", "RATE_LIMITED", "NEW_REQUEST_REQUIRED", "REQUEST_CONFLICT",
    "TARGET_NOT_FOUND", "FLASHCARDS_UNAVAILABLE", "NETWORK_ERROR", "UNKNOWN",
  ];
  for (const code of codes) {
    const message = flashcardErrorMessage(new FlashcardGenerationError(code));
    assert.ok(message.length > 10, `${code} has no usable message`);
    assert.ok(!message.includes(code), `${code} leaks the raw code`);
  }
});

test("only queued and processing count as running", () => {
  for (const status of ["queued", "processing"]) {
    assert.equal(isFlashcardJobRunning(job({ status })), true, status);
  }
  // `estimated` und `review` warten auf den Nutzer, nicht auf den Server.
  for (const status of ["estimated", "review", "completed", "failed", "cancelled"]) {
    assert.equal(isFlashcardJobRunning(job({ status })), false, status);
  }
});

test("progress follows the phase and never exceeds 100 percent", () => {
  const unknownTotal = flashcardProgress(job({ phase: "analyze", total: 0 }));
  assert.equal(unknownTotal.indeterminate, true);
  assert.equal(unknownTotal.percent, null);

  const analyzing = flashcardProgress(job({ phase: "analyze", analyzed: 3, total: 12 }));
  assert.equal(analyzing.percent, 25);
  assert.equal(analyzing.label, "Unterlagen werden gelesen");

  const generating = flashcardProgress(job({ phase: "generate", generated: 8, estimatedCount: 16 }));
  assert.equal(generating.percent, 50);
  assert.equal(generating.label, "Karten werden erstellt");

  // Das Backend liefert die Karten in Achterschritten; der letzte darf nicht über 100 laufen.
  assert.equal(flashcardProgress(job({ phase: "generate", generated: 20, estimatedCount: 17 })).percent, 100);
});

test("card validity mirrors the backend length limits", () => {
  assert.equal(isCardValid({ question: "Was ist X?", answer: "Y" }), true);
  assert.equal(isCardValid({ question: "   ", answer: "Y" }), false);
  assert.equal(isCardValid({ question: "Frage", answer: "  " }), false);
  assert.equal(isCardValid({ question: "a".repeat(MAX_QUESTION_LENGTH), answer: "b" }), true);
  assert.equal(isCardValid({ question: "a".repeat(MAX_QUESTION_LENGTH + 1), answer: "b" }), false);
  assert.equal(isCardValid({ question: "a", answer: "b".repeat(MAX_ANSWER_LENGTH + 1) }), false);
});

test("saving is blocked before the backend can reject it", () => {
  const good = [{ question: "F", answer: "A" }];
  assert.deepEqual(validateDeckSave("Mein Deck", good), { ok: true });

  assert.equal(validateDeckSave("  ", good).ok, false);
  assert.equal(validateDeckSave("a".repeat(201), good).ok, false);
  assert.equal(validateDeckSave("Deck", []).ok, false);
  assert.equal(validateDeckSave("Deck", Array(MAX_REQUESTED_CARDS + 1).fill({ question: "F", answer: "A" })).ok, false);
  assert.equal(validateDeckSave("Deck", [{ question: "F", answer: "" }]).ok, false);

  // Jede Ablehnung erklärt sich auf Deutsch.
  const rejected = validateDeckSave("", good);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.message.length > 5);
});

test("a job payload without id or a known status is rejected", () => {
  assert.throws(() => parseFlashcardJob({}), FlashcardGenerationError);
  assert.throws(() => parseFlashcardJob({ id: "j" }), FlashcardGenerationError);
  assert.throws(() => parseFlashcardJob({ id: "j", status: "paused" }), FlashcardGenerationError);
});

test("a job payload is normalised and malformed cards are dropped", () => {
  const parsed = parseFlashcardJob({
    id: "job-1", status: "review", phase: "generate", error_code: null,
    material_id: null, requested_count: 20,
    analyzed: 12, total: 12, estimated_count: 16, generated: 16,
    cards: [
      { id: "c1", question: "Was ist X?", answer: "X ist …", source_ids: ["s1"] },
      { id: "c2", question: "Ohne Antwort" },
      { question: "Ohne id", answer: "A" },
    ],
    sources: [
      { id: "s1", document_id: "doc-1", title: "Vorlesung 1", page: 4 },
      { id: "s2", document_id: "doc-2" },
    ],
  });

  assert.equal(parsed.status, "review");
  assert.equal(parsed.phase, "generate");
  assert.equal(parsed.cards.length, 1);
  assert.deepEqual(parsed.cards[0].sourceIds, ["s1"]);
  // Eine Quelle ohne Titel ist nicht anzeigbar.
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].page, 4);
});

test("negative or non-numeric counters fall back to zero instead of rendering nonsense", () => {
  const parsed = parseFlashcardJob({
    id: "j", status: "processing", analyzed: -3, total: "12", estimated_count: null, generated: 2,
  });
  assert.equal(parsed.analyzed, 0);
  assert.equal(parsed.total, 0);
  assert.equal(parsed.estimatedCount, 0);
  assert.equal(parsed.generated, 2);
  // Unbekannte Phase fällt auf die erste Stufe zurück.
  assert.equal(parsed.phase, "analyze");
});

test("the document list keeps only entries with an id and marks readiness strictly", () => {
  const docs = parseSelectableDocuments([
    { id: "d1", title: "Skript", ready: true },
    { id: "d2", ready: "true" },
    { title: "Ohne id", ready: true },
  ]);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].ready, true);
  assert.equal(docs[1].title, "Unbenannte Unterlage");
  // Nur echtes true gilt als verarbeitet.
  assert.equal(docs[1].ready, false);
  assert.deepEqual(parseSelectableDocuments(null), []);
});
