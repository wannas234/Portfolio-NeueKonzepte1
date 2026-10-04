import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAttemptComplete,
  QUIZ_MAX_QUESTIONS,
  QUIZ_OPTION_MAX,
  QUIZ_QUESTION_MAX,
  QUIZ_TITLE_MAX,
  validateQuiz,
} from "./quiz-format.ts";

const question = (overrides = {}) => ({
  question: "Was ist ein Prozess?",
  options: ["A", "B", "C", "D"],
  correctIndex: 1,
  ...overrides,
});

test("a well-formed quiz passes", () => {
  assert.deepEqual(validateQuiz("Wiederholung", [question()]), { ok: true });
  assert.deepEqual(validateQuiz("Wiederholung", Array(QUIZ_MAX_QUESTIONS).fill(question())), { ok: true });
});

test("title and question count follow the backend limits", () => {
  assert.equal(validateQuiz("  ", [question()]).ok, false);
  assert.equal(validateQuiz("a".repeat(QUIZ_TITLE_MAX), [question()]).ok, true);
  assert.equal(validateQuiz("a".repeat(QUIZ_TITLE_MAX + 1), [question()]).ok, false);
  assert.equal(validateQuiz("Test", []).ok, false);
  assert.equal(validateQuiz("Test", Array(QUIZ_MAX_QUESTIONS + 1).fill(question())).ok, false);
});

test("every question needs text, exactly four filled options and one marked answer", () => {
  assert.equal(validateQuiz("Test", [question({ question: "   " })]).ok, false);
  assert.equal(validateQuiz("Test", [question({ question: "a".repeat(QUIZ_QUESTION_MAX + 1) })]).ok, false);
  assert.equal(validateQuiz("Test", [question({ options: ["A", "B", "C"] })]).ok, false);
  assert.equal(validateQuiz("Test", [question({ options: ["A", "B", "C", "D", "E"] })]).ok, false);
  assert.equal(validateQuiz("Test", [question({ options: ["A", " ", "C", "D"] })]).ok, false);
  assert.equal(validateQuiz("Test", [question({ options: ["A", "B", "C", "x".repeat(QUIZ_OPTION_MAX + 1)] })]).ok, false);
});

test("correctIndex must be a whole number between 0 and 3", () => {
  for (const correctIndex of [0, 1, 2, 3]) {
    assert.equal(validateQuiz("Test", [question({ correctIndex })]).ok, true, String(correctIndex));
  }
  for (const correctIndex of [-1, 4, 1.5, Number.NaN, "1"]) {
    assert.equal(validateQuiz("Test", [question({ correctIndex })]).ok, false, String(correctIndex));
  }
});

test("every rejection explains itself in German", () => {
  const rejected = [
    validateQuiz("", [question()]),
    validateQuiz("Test", []),
    validateQuiz("Test", [question({ options: ["A", "B"] })]),
    validateQuiz("Test", [question({ correctIndex: 9 })]),
  ];
  for (const result of rejected) {
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 10);
  }
});

test("an attempt may only be submitted once every question is answered", () => {
  assert.equal(isAttemptComplete([0, 1, 2], 3), true);
  assert.equal(isAttemptComplete([0, null, 2], 3), false);
  // Eine zu kurze Antwortliste gilt nicht als vollständig.
  assert.equal(isAttemptComplete([0, 1], 3), false);
  assert.equal(isAttemptComplete([], 0), false);
});

test('reading preserves sources and explanations, and rejects positional corruption', async () => {
 const {parseQuizQuestions}=await import('./quiz-format.ts');
 const q={...question(), explanation:'Because',sources:[{source_document_id:'d',material_id:'m',chunk_id:'c',title:'Title',page_number:2,excerpt:'Text'}]};
 assert.deepEqual(parseQuizQuestions([q]),[q]);
 assert.throws(()=>parseQuizQuestions([q,null,q]));
 assert.throws(()=>parseQuizQuestions([q,{...q,options:['A','B',null,'D']} ]));
 assert.equal(isAttemptComplete([4],1),false);
});
