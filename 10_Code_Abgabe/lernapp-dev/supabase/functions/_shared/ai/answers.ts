import type { PromptMessage } from '../answers.ts';
import { MAX_ANSWER_LENGTH } from '../answers.ts';
import type { AnswerConfiguration, AnswerProvider } from './config.ts';

export interface AnswerResult {
  answer: string;
  provider: AnswerProvider;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

function tokenCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483647)
    throw new Error('INVALID_ANSWER_RESPONSE');
  return Number(value);
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const options = {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    redirect: 'error' as const,
  };
  let response = await fetch(url, options);
  // One bounded retry for transient provider failures, within the same deadline.
  if ([502, 503, 504].includes(response.status)) {
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500));
    signal.throwIfAborted();
    response = await fetch(url, options);
  }
  if (!response.ok) {
    // Log only transport metadata; provider bodies can contain user input.
    console.error(
      JSON.stringify({
        event: 'answer_provider_failed',
        host: new URL(url).hostname,
        status: response.status,
      }),
    );
    await response.body?.cancel();
    throw new Error('ANSWERS_UNAVAILABLE');
  }
  return await response.json();
}

async function openai(
  messages: PromptMessage[],
  config: AnswerConfiguration,
  signal: AbortSignal,
): Promise<AnswerResult> {
  const body = await post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: config.model,
      messages,
      max_completion_tokens: config.maxOutputTokens,
      store: false,
    },
    { Authorization: `Bearer ${config.key}` },
    signal,
  );
  const choice = body?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || choice?.message?.refusal || choice?.message?.tool_calls)
    throw new Error('INCOMPLETE_ANSWER');
  return {
    answer: choice?.message?.content,
    provider: 'openai',
    model: body?.model,
    inputTokens: tokenCount(body?.usage?.prompt_tokens),
    outputTokens: tokenCount(body?.usage?.completion_tokens),
  };
}

async function gemini(
  messages: PromptMessage[],
  config: AnswerConfiguration,
  signal: AbortSignal,
): Promise<AnswerResult> {
  const body = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      systemInstruction: {
        parts: messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content })),
      },
      contents: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      generationConfig: { maxOutputTokens: config.maxOutputTokens, candidateCount: 1 },
    },
    { 'x-goog-api-key': config.key },
    signal,
  );
  const candidate = body?.candidates?.[0];
  if (
    body?.promptFeedback?.blockReason ||
    candidate?.finishReason !== 'STOP' ||
    !Array.isArray(candidate?.content?.parts)
  )
    throw new Error('INCOMPLETE_ANSWER');
  const parts = candidate.content.parts as {
    text?: unknown;
    thought?: boolean;
    functionCall?: unknown;
  }[];
  if (parts.some((p) => p.functionCall)) throw new Error('INCOMPLETE_ANSWER');
  const output = tokenCount(body?.usageMetadata?.candidatesTokenCount);
  const thoughts = tokenCount(body?.usageMetadata?.thoughtsTokenCount);
  return {
    answer: parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join(''),
    provider: 'gemini',
    model: body?.modelVersion,
    inputTokens: tokenCount(body?.usageMetadata?.promptTokenCount),
    outputTokens: output === null ? null : tokenCount(output + (thoughts ?? 0)),
  };
}

export async function requestAnswer(
  messages: PromptMessage[],
  config: AnswerConfiguration,
  signal?: AbortSignal,
  maxAnswerLength = MAX_ANSWER_LENGTH,
): Promise<AnswerResult> {
  const deadline = AbortSignal.timeout(60000);
  const result = await (config.provider === 'openai' ? openai : gemini)(
    messages,
    config,
    signal ? AbortSignal.any([signal, deadline]) : deadline,
  );
  if (
    typeof result.answer !== 'string' ||
    !result.answer.trim() ||
    result.answer.length > maxAnswerLength ||
    typeof result.model !== 'string' ||
    !result.model.trim() ||
    result.model.length > 100
  )
    throw new Error('INVALID_ANSWER_RESPONSE');
  return { ...result, answer: result.answer.trim() };
}
