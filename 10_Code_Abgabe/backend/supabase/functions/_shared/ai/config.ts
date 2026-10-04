export type AnswerProvider = 'openai' | 'gemini';

export interface AnswerConfiguration {
  provider: AnswerProvider;
  model: string;
  key: string;
  maxOutputTokens: number;
  questionsPerMinute: number;
  concurrentResponsesPerUser: number;
}

function integer(name: string, fallback: number, maximum: number): number {
  const raw = Deno.env.get(name)?.trim() ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error('ANSWERS_NOT_CONFIGURED');
  return value;
}

export function answerConfiguration(): AnswerConfiguration {
  const provider = Deno.env.get('ANSWER_PROVIDER')?.trim() ?? 'openai';
  if (provider !== 'openai' && provider !== 'gemini') throw new Error('ANSWERS_NOT_CONFIGURED');
  // Independent names let one switch providers without accidentally keeping the
  // other provider's model. Gemini is explicit; no silently changing model alias.
  const model = (
    Deno.env.get(provider === 'openai' ? 'OPENAI_ANSWER_MODEL' : 'GEMINI_ANSWER_MODEL') ??
    (provider === 'openai' ? 'gpt-4o-mini' : '')
  ).trim();
  const key = Deno.env.get(provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY')?.trim();
  if (!key || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model))
    throw new Error('ANSWERS_NOT_CONFIGURED');
  return {
    provider,
    model,
    key,
    maxOutputTokens: integer('AI_MAX_OUTPUT_TOKENS', 800, 8192),
    questionsPerMinute: integer('AI_QUESTIONS_PER_MINUTE', 6, 100),
    concurrentResponsesPerUser: integer('AI_CONCURRENT_RESPONSES_PER_USER', 1, 10),
  };
}
