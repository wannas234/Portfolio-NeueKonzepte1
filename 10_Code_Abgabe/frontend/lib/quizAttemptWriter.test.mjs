import { test } from "node:test";
import assert from "node:assert/strict";
import { QuizAttemptWriter } from "./quizAttemptWriter.ts";
const base = () => ({
  id: "attempt",
  quizId: "quiz",
  revision: 1,
  answers: [null, null],
  score: null,
  submittedAt: null,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("fast answers serialize, then submit with the latest revision", async () => {
  const calls = [];
  let release;
  const writer = new QuizAttemptWriter(base(), async (input) => {
    calls.push(input);
    if (calls.length === 1) await new Promise((r) => (release = r));
    return {
      ...base(),
      answers: input.answers,
      revision: input.expectedRevision + 1,
      submittedAt: input.submit ? "now" : null,
    };
  });
  writer.answer(0, 1);
  await tick();
  writer.answer(1, 2);
  const finished = writer.submit();
  assert.equal(calls.length, 1);
  release();
  await finished;
  assert.deepEqual(
    calls.map((c) => c.expectedRevision),
    [1, 2],
  );
  assert.deepEqual(calls[1].answers, [1, 2]);
  assert.equal(calls[1].submit, true);
  assert.equal(writer.dirty, false);
});
test("network retry retains the original payload and revision, then flushes newer answers", async () => {
  const calls = [];
  let fail = true;
  const writer = new QuizAttemptWriter(base(), async (input) => {
    calls.push(structuredClone(input));
    if (fail) throw new Error("network");
    return {
      ...base(),
      answers: input.answers,
      revision: input.expectedRevision + 1,
    };
  });
  writer.answer(0, 1);
  await tick();
  writer.answer(1, 3);
  fail = false;
  await writer.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[2].answers, [1, 3]);
  assert.equal(calls[2].expectedRevision, 2);
});
test("conflicts stop further writes and preserve local answers", async () => {
  let calls = 0;
  const writer = new QuizAttemptWriter(base(), async () => {
    calls++;
    throw new Error("ATTEMPT_CONFLICT");
  });
  writer.answer(0, 2);
  await tick();
  writer.answer(1, 1);
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(writer.answers, [2, 1]);
  assert.ok(writer.error);
  assert.equal(writer.dirty, true);
});
