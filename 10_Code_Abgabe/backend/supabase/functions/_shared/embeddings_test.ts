import { embedTexts } from './embeddings.ts';

Deno.test(
  'Gemini batch embeddings preserve chunk order, purpose, dimensions and normalization',
  async () => {
    const original = globalThis.fetch;
    try {
      for (const purpose of ['document', 'query'] as const) {
        globalThis.fetch = (input, init) => {
          if (
            String(input) !==
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents'
          )
            throw new Error('Wrong model endpoint');
          if (new Headers(init?.headers).get('x-goog-api-key') !== 'test-key')
            throw new Error('Key missing');
          const body = JSON.parse(String(init?.body));
          if (body.requests.length !== 2) throw new Error('Chunks aggregated');
          for (const [i, request] of body.requests.entries()) {
            const text = ['first', 'second'][i];
            if (
              request.model !== 'models/gemini-embedding-2' ||
              request.outputDimensionality !== 1536 ||
              'taskType' in request ||
              request.content.parts[0].text !==
                (purpose === 'query'
                  ? `task: search result | query: ${text}`
                  : `title: none | text: ${text}`)
            )
              throw new Error('Invalid Gemini 2 contract');
          }
          return Promise.resolve(
            Response.json({
              embeddings: [
                { values: [2, ...new Array(1535).fill(0)] },
                { values: [-3, ...new Array(1535).fill(0)] },
              ],
            }),
          );
        };
        const result = await embedTexts(['first', 'second'], 'test-key', undefined, purpose);
        if (result[0][0] !== 1 || result[1][0] !== -1)
          throw new Error('Order or normalization lost');
      }
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  'Gemini adapter rejects malformed responses and never publishes partial batches',
  async () => {
    const original = globalThis.fetch;
    try {
      for (const scenario of ['dimension', 'zero', 'missing', 'null', 'string', 'outage']) {
        globalThis.fetch = () => {
          const values = new Array(scenario === 'dimension' ? 10 : 1536).fill(0);
          values[0] = scenario === 'zero' ? 0 : scenario === 'string' ? '1' : 1;
          return Promise.resolve(
            Response.json(
              {
                embeddings: scenario === 'missing' ? [] : [scenario === 'null' ? null : { values }],
              },
              { status: scenario === 'outage' ? 429 : 200 },
            ),
          );
        };
        let rejected = false;
        try {
          await embedTexts(['query'], 'test-key');
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error(`Accepted ${scenario}`);
      }
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  'Embedding configuration cannot silently change the stored Gemini vector space',
  async () => {
    const names = ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSIONS'];
    const previous = names.map((name) => Deno.env.get(name));
    const original = globalThis.fetch;
    try {
      for (const name of names) Deno.env.delete(name);
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw new Error('Unexpected provider call');
      };
      for (const [name, value] of [
        ['EMBEDDING_PROVIDER', 'openai'],
        ['EMBEDDING_MODEL', 'gemini-embedding-001'],
        ['EMBEDDING_DIMENSIONS', '768'],
      ]) {
        Deno.env.set(name, value);
        let rejected = false;
        try {
          await embedTexts(['query'], 'test-key');
        } catch (error) {
          rejected = error instanceof Error && error.message === 'EMBEDDING_CONTRACT_MISMATCH';
        }
        if (!rejected || calls) throw new Error('Incompatible vector space used');
        Deno.env.delete(name);
      }
      for (const inputs of [[''], ['x'.repeat(1801)], new Array(33).fill('x')]) {
        let rejected = false;
        try {
          await embedTexts(inputs, 'test-key');
        } catch {
          rejected = true;
        }
        if (!rejected || calls) throw new Error('Invalid input sent');
      }
      if ((await embedTexts([], 'test-key')).length || calls) throw new Error('Empty batch sent');
    } finally {
      globalThis.fetch = original;
      names.forEach((name, i) =>
        previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
      );
    }
  },
);
