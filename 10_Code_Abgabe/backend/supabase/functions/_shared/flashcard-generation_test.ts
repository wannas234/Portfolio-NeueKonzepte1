import { apply, messages, parseCards, plan } from './flashcard-generation.ts';
function assert(v: unknown): asserts v {
  if (!v) throw new Error('assertion failed');
}
function rejects(fn: () => unknown) {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  assert(failed);
}
const docs = [
  {
    id: 'd1',
    material_id: 'm1',
    file_id: 'f1',
    title: 'Vorlesung',
    text: 'Definition. Zusammenhang.',
    pages: [{ page: 1, text: 'Definition. Zusammenhang.' }],
  },
];
const card = {
  question: 'Was ist X?',
  answer: 'Ein belegter Begriff.',
  source_ids: ['S1'],
};
Deno.test(
  'Automatic count derives from deduplicated points; source page survives generation',
  () => {
    const cp = plan(docs);
    assert(cp.sources[0].page === 1 && cp.sources[0].file_id === 'f1');
    assert(
      apply(
        cp,
        'analyze',
        JSON.stringify({
          cards: [
            card,
            card,
            {
              ...card,
              question: 'Wie hängt X mit Y zusammen?',
            },
          ],
        }),
        null,
      ) === 'queued',
    );
    assert(cp.points.length === 2);
    assert(messages(cp, 'analyze', null)[0].content.includes('nicht nach Seitenzahl'));
    assert(apply(cp, 'analyze', '{"indices":[0,1]}', null) === 'estimated');
    assert(cp.selected.length === 2 && cp.cards.length === 0);
    assert(
      apply(
        cp,
        'generate',
        JSON.stringify({
          cards: [card, { ...card, question: 'Wie hängt X mit Y zusammen?' }],
        }),
        null,
      ) === 'review',
    );
    assert(Number(cp.cards.length) === 2 && cp.generated === 2);
  },
);
Deno.test(
  'Manual target is an upper bound; malformed indices and foreign references are rejected',
  () => {
    const cp = plan(docs);
    apply(cp, 'analyze', JSON.stringify({ cards: [card] }), 1);
    rejects(() => apply(cp, 'analyze', '{"indices":[0,0]}', 1));
    rejects(() => apply(cp, 'analyze', '{"indices":[1]}', 1));
    assert(apply(cp, 'analyze', '{"indices":[0]}', 1) === 'estimated');
    rejects(() =>
      parseCards(JSON.stringify({ cards: [{ ...card, source_ids: ['foreign'] }] }), ['S1'], 8),
    );
    rejects(() =>
      parseCards('{"cards":[{"question":"","answer":"x","source_ids":["S1"]}]}', ['S1'], 8),
    );
    rejects(() => apply(cp, 'generate', '{"cards":[]}', 1));
  },
);
Deno.test('No artificial minimum for empty teaching material', () => {
  const cp = plan(docs);
  apply(cp, 'analyze', '{"cards":[]}', null);
  rejects(() => apply(cp, 'analyze', '{"indices":[]}', null));
});
Deno.test('Long sources are fully covered and no generation starts before analysis', () => {
  const text = 'Lehrinhalt '.repeat(2200);
  const cp = plan([{ ...docs[0], text, pages: null }]);
  assert(cp.chunks.length > 1);
  assert(cp.chunks.map((c) => c.text.replace(/\n\[S1\]\n/g, '')).join('') === text);
  assert(cp.selected.length === 0 && cp.cards.length === 0);
});
