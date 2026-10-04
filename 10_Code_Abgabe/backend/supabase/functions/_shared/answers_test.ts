import {
  boundedHistory,
  buildMessages,
  type ChatTurn,
  citedSources,
  MAX_HISTORY_CHARACTERS,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_LENGTH,
  type Passage,
  retrievalQuery,
} from './answers.ts';

const passage = (citation_no: number, page_number: number | null = 17): Passage => ({
  citation_no,
  chunk_id: `chunk-${citation_no}`,
  source_document_id: 'document',
  material_id: 'material',
  material_title: 'Vorlesung 03',
  page_number,
  excerpt: `Auszug ${citation_no}`,
  similarity: 0.8,
});

Deno.test('Retrieval query carries the previous question into a follow-up', () => {
  const history: ChatTurn[] = [
    { role: 'user', content: 'Was bedeutet Preiselastizität?' },
    { role: 'assistant', content: 'Sie misst die Mengenreaktion [1].' },
  ];
  if (retrievalQuery([], 'Was bedeutet Preiselastizität?') !== 'Was bedeutet Preiselastizität?')
    throw new Error('First question altered');
  const followUp = retrievalQuery(history, '  Wie berechnet man sie?  ');
  if (followUp !== 'Was bedeutet Preiselastizität?\nWie berechnet man sie?')
    throw new Error('Context lost');
  // Only the assistant spoke last, but the topic comes from the last user turn.
  if (!retrievalQuery([history[1]], 'Und warum?').startsWith('Und warum?'))
    throw new Error('Assistant text used as context');
  const long = retrievalQuery([{ role: 'user', content: 'x'.repeat(4000) }], 'Kurzfrage');
  if (long.length > MAX_QUESTION_LENGTH || !long.endsWith('Kurzfrage'))
    throw new Error('Current question not preserved');
  const nearLimit = retrievalQuery(history, 'y'.repeat(MAX_QUESTION_LENGTH));
  if (nearLimit !== 'y'.repeat(MAX_QUESTION_LENGTH)) throw new Error('Full question truncated');
});

Deno.test('History stays bounded by turns and characters', () => {
  const many: ChatTurn[] = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Turn ${index}`,
  }));
  const bounded = boundedHistory(many);
  if (bounded.length !== MAX_HISTORY_MESSAGES) throw new Error('Turn limit ignored');
  if (bounded.at(-1)?.content !== 'Turn 29') throw new Error('Newest turn dropped');
  const heavy = boundedHistory([
    { role: 'user', content: 'x'.repeat(MAX_HISTORY_CHARACTERS) },
    { role: 'assistant', content: 'Letzte Antwort' },
  ]);
  if (heavy.length !== 1 || heavy[0].content !== 'Letzte Antwort')
    throw new Error('Character budget ignored');
});

Deno.test('Prompt numbers the passages and names their page', () => {
  const messages = buildMessages([{ role: 'user', content: 'Frühere Frage' }], 'Frage', [
    passage(1),
    passage(2, null),
  ]);
  if (messages[0].role !== 'system') throw new Error('Instructions missing');
  if (messages[1].content !== 'Frühere Frage') throw new Error('History dropped');
  const last = messages.at(-1)!.content;
  if (!last.includes('[1] (Vorlesung 03, S. 17)')) throw new Error('Page reference missing');
  if (!last.includes('[2] (Vorlesung 03)\n')) throw new Error('Missing page not handled');
  if (!last.endsWith('Frage: Frage')) throw new Error('Question missing');
});

Deno.test('Only cited passages become sources', () => {
  const passages = [passage(1), passage(2), passage(3)];
  const cited = citedSources('Erst [3], dann [1][3].', passages);
  if (cited.map((source) => source.citation_no).join() !== '1,3')
    throw new Error('Citation parsing wrong');
  if (citedSources('Dazu steht nichts in den Materialien.', passages).length !== 0)
    throw new Error('Abstention invented sources');
});

Deno.test('Unknown and malformed numeric citations are rejected', () => {
  for (const answer of [
    'Antwort [9]',
    'Antwort [0]',
    'Antwort [100]',
    'Antwort [01]',
    'Antwort [1',
    'Antwort [1\nRest',
    'Antwort [1,2]',
    'Antwort [ 1 ]',
    'Antwort [1](https://example.com)',
    'Antwort [1]: erfunden',
  ]) {
    let rejected = false;
    try {
      citedSources(answer, [passage(1)]);
    } catch (error) {
      rejected = error instanceof Error && error.message === 'INVALID_CITATION';
    }
    if (!rejected) throw new Error(`Invalid citation accepted: ${answer}`);
  }
});
