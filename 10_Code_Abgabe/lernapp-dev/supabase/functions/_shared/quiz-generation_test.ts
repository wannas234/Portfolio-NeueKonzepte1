import { apply, plan, parseQuestions } from './quiz-generation.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
const q = {
  question: 'Was ist X?',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 1,
  explanation: 'B folgt aus dem Text.',
  source_chunk_ids: ['chunk'],
};
Deno.test('Quiz pipeline analyzes, plans and generates with original chunk provenance', () => {
  const cp = plan({ chunks: [{ id: 'chunk', text: 'X ist B.', page_number: 2 }] });
  assert(
    apply(
      cp,
      'analyze',
      JSON.stringify({ cards: [{ question: 'X?', answer: 'B', source_ids: ['chunk'] }] }),
      5,
    ) === 'queued',
  );
  assert(apply(cp, 'analyze', '{"indices":[0]}', 5) === 'queued' && cp.planned);
  assert(apply(cp, 'generate', JSON.stringify({ questions: [q] }), 5) === 'completed');
  assert(
    cp.questions[0].source_chunk_ids[0] === 'chunk' &&
      cp.questions[0].explanation === q.explanation,
  );
});
Deno.test(
  'Malformed questions, duplicates, missing explanations and foreign sources fail closed',
  () => {
    for (const bad of [
      null,
      { ...q, options: ['A', 'a', 'C', 'D'] },
      { ...q, correctIndex: 0.5 },
      { ...q, correctIndex: 4 },
      { ...q, explanation: '' },
      { ...q, source_chunk_ids: ['foreign'] },
      { ...q, options: [1, 2, 3, 4] },
    ]) {
      let failed = false;
      try {
        parseQuestions(JSON.stringify({ questions: [bad] }), [['chunk']]);
      } catch {
        failed = true;
      }
      assert(failed);
    }
    let failed = false;
    try {
      parseQuestions(JSON.stringify({ questions: [q, q] }), [['chunk'], ['chunk']]);
    } catch {
      failed = true;
    }
    assert(failed);
  },
);
Deno.test('Invalid generation preserves checkpoint for bounded retry', () => {
  const cp = plan({ chunks: [{ id: 'chunk', text: 'Text', page_number: null }] });
  cp.points = [{ question: 'Q', answer: 'B', source_ids: ['chunk'] }];
  cp.selected = [0];
  cp.planned = true;
  const before = JSON.stringify(cp);
  try {
    apply(cp, 'generate', '{"questions":[]}', 1);
  } catch {
    /* expected */
  }
  assert(JSON.stringify(cp) === before);
});
