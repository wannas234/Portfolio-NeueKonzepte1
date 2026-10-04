import { requestAnswer } from './answers.ts';
import { answerConfiguration, type AnswerConfiguration } from './config.ts';
import { buildMessages } from '../answers.ts';

Deno.test('Transient answer failures retry once; persistent failures remain bounded', async () => {
  const original = globalThis.fetch;
  try {
    for (const recovers of [true, false]) {
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(
          calls === 2 && recovers
            ? Response.json({
                modelVersion: 'test-model',
                candidates: [
                  { finishReason: 'STOP', content: { parts: [{ text: 'Antwort [1]' }] } },
                ],
              })
            : Response.json({}, { status: 503 }),
        );
      };
      let answer;
      let failure;
      try {
        answer = await requestAnswer([{ role: 'user', content: 'Frage' }], {
          provider: 'gemini',
          model: 'test-model',
          key: 'test-key',
          maxOutputTokens: 800,
          questionsPerMinute: 6,
          concurrentResponsesPerUser: 1,
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : undefined;
      }
      if (calls !== 2) throw new Error('Retry count must be bounded');
      if (recovers ? answer?.answer !== 'Antwort [1]' : failure !== 'ANSWERS_UNAVAILABLE')
        throw new Error('Unexpected retry result');
    }
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test(
  'Provider failures log HTTP status without credentials or response contents',
  async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logs: string[] = [];
    try {
      console.error = (message: string) => logs.push(message);
      globalThis.fetch = () =>
        Promise.resolve(
          Response.json({ error: { message: 'private document text' } }, { status: 429 }),
        );
      let code;
      try {
        await requestAnswer([{ role: 'user', content: 'private question' }], {
          provider: 'gemini',
          model: 'test-model',
          key: 'private-key',
          maxOutputTokens: 800,
          questionsPerMinute: 6,
          concurrentResponsesPerUser: 1,
        });
      } catch (error) {
        code = error instanceof Error ? error.message : undefined;
      }
      if (code !== 'ANSWERS_UNAVAILABLE') throw new Error('Provider failure not preserved');
      if (
        logs.length !== 1 ||
        logs[0] !==
          JSON.stringify({
            event: 'answer_provider_failed',
            host: 'generativelanguage.googleapis.com',
            status: 429,
          })
      )
        throw new Error('Unexpected provider diagnostic');
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
    }
  },
);

Deno.test(
  'Both answer adapters preserve prompts, account for usage and reject incomplete output',
  async () => {
    const original = globalThis.fetch;
    const messages = buildMessages([{ role: 'assistant', content: 'Verlauf [1]' }], 'Frage', []);
    try {
      for (const provider of ['openai', 'gemini'] as const) {
        for (const scenario of [
          'success',
          'missing_usage',
          'truncated',
          'blocked',
          'empty',
          'model',
          'usage',
          'outage',
        ]) {
          const config: AnswerConfiguration = {
            provider,
            model: 'test-model',
            key: 'secret',
            maxOutputTokens: 800,
            questionsPerMinute: 6,
            concurrentResponsesPerUser: 1,
          };
          globalThis.fetch = (input, init) => {
            const url = String(input);
            const request = JSON.parse(String(init?.body));
            if (url.includes('embedd')) throw new Error('Answer adapter must not embed');
            const text = scenario === 'empty' ? ' ' : 'Antwort [1]';
            if (provider === 'openai') {
              if (
                JSON.stringify(request.messages) !== JSON.stringify(messages) ||
                request.max_completion_tokens !== 800 ||
                request.store !== false
              )
                throw new Error('Prompt changed');
              return Promise.resolve(
                Response.json(
                  {
                    model: scenario === 'model' ? null : 'resolved-model',
                    choices: [
                      {
                        finish_reason: scenario === 'truncated' ? 'length' : 'stop',
                        message: {
                          content: text,
                          refusal: scenario === 'blocked' ? 'blocked' : null,
                        },
                      },
                    ],
                    usage:
                      scenario === 'missing_usage'
                        ? undefined
                        : { prompt_tokens: scenario === 'usage' ? -1 : 20, completion_tokens: 5 },
                  },
                  { status: scenario === 'outage' ? 429 : 200 },
                ),
              );
            }
            if (
              request.systemInstruction.parts[0].text !== messages[0].content ||
              request.contents.at(-1).parts[0].text !== messages.at(-1)!.content ||
              request.contents[0].role !== 'model' ||
              request.generationConfig.maxOutputTokens !== 800
            )
              throw new Error('Gemini prompt changed');
            if (
              new Headers(init?.headers).get('x-goog-api-key') !== 'secret' ||
              url.includes('secret')
            )
              throw new Error('Key transport');
            return Promise.resolve(
              Response.json(
                {
                  modelVersion: scenario === 'model' ? null : 'resolved-model',
                  promptFeedback: scenario === 'blocked' ? { blockReason: 'SAFETY' } : {},
                  candidates: [
                    {
                      finishReason: scenario === 'truncated' ? 'MAX_TOKENS' : 'STOP',
                      content: { parts: [{ text: 'Private reasoning', thought: true }, { text }] },
                    },
                  ],
                  usageMetadata:
                    scenario === 'missing_usage'
                      ? undefined
                      : {
                          promptTokenCount: scenario === 'usage' ? -1 : 20,
                          candidatesTokenCount: 3,
                          thoughtsTokenCount: 2,
                        },
                },
                { status: scenario === 'outage' ? 429 : 200 },
              ),
            );
          };
          if (scenario === 'success' || scenario === 'missing_usage') {
            const answer = await requestAnswer(messages, config);
            if (
              answer.answer !== 'Antwort [1]' ||
              answer.model !== 'resolved-model' ||
              answer.provider !== provider ||
              answer.inputTokens !== (scenario === 'success' ? 20 : null) ||
              answer.outputTokens !== (scenario === 'success' ? 5 : null)
            )
              throw new Error(`Invalid ${provider} result`);
          } else {
            let rejected = false;
            try {
              await requestAnswer(messages, config);
            } catch {
              rejected = true;
            }
            if (!rejected) throw new Error(`Accepted ${provider} ${scenario}`);
          }
        }
      }
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test('Provider switch uses independent models and rejects invalid configuration', () => {
  const names = [
    'ANSWER_PROVIDER',
    'OPENAI_ANSWER_MODEL',
    'GEMINI_ANSWER_MODEL',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'AI_QUESTIONS_PER_MINUTE',
  ];
  const previous = names.map((name) => Deno.env.get(name));
  try {
    Deno.env.set('OPENAI_API_KEY', 'openai-key');
    Deno.env.set('GEMINI_API_KEY', 'gemini-key');
    Deno.env.set('OPENAI_ANSWER_MODEL', 'openai-model');
    Deno.env.set('GEMINI_ANSWER_MODEL', 'gemini-model');
    Deno.env.set('AI_QUESTIONS_PER_MINUTE', '6');
    for (const provider of ['openai', 'gemini']) {
      Deno.env.set('ANSWER_PROVIDER', provider);
      const config = answerConfiguration();
      if (config.model !== `${provider}-model` || config.key !== `${provider}-key`)
        throw new Error('Provider configuration mixed');
    }
    for (const [key, value] of [
      ['ANSWER_PROVIDER', 'unknown'],
      ['GEMINI_ANSWER_MODEL', ''],
      ['AI_QUESTIONS_PER_MINUTE', '0'],
    ]) {
      const saved = Deno.env.get(key)!;
      Deno.env.set(key, value);
      let rejected = false;
      try {
        answerConfiguration();
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`Invalid ${key} accepted`);
      Deno.env.set(key, saved);
    }
  } finally {
    names.forEach((name, i) =>
      previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
    );
  }
});
