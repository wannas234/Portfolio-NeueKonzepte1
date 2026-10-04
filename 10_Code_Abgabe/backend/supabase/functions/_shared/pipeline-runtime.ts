/** Bounded foreground work only. Durable jobs, not promises, own continuation. */
export function setting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(Deno.env.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error('INVALID_PIPELINE_CONFIG');
  return value;
}
export class WorkBudget {
  readonly deadline: number;
  constructor(
    ms = setting('DOCUMENT_WORKER_BUDGET_MS', 75000, 15000, 75000),
    private now = () => performance.now(),
  ) {
    this.deadline = now() + ms;
  }
  remaining(): number {
    return Math.max(0, this.deadline - this.now());
  }
  canStart(): boolean {
    return this.remaining() >= 15000;
  }
  rpcSignal(): AbortSignal {
    return AbortSignal.timeout(Math.max(1, Math.floor(this.deadline + 10000 - this.now())));
  }
  signal(): AbortSignal {
    return AbortSignal.timeout(Math.max(1, Math.floor(this.remaining() - 10000)));
  }
}
export class ProviderError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number,
    public attempts: { duration_ms: number; status: number }[] = [],
  ) {
    super(`PROVIDER_HTTP_${status}`);
  }
}
export function retryDelay(
  value: string | null,
  attempt: number,
  now = Date.now(),
  random = Math.random,
): number {
  const parsed =
    value === null
      ? 0
      : /^\d+(\.\d+)?$/.test(value)
        ? Number(value) * 1000
        : Date.parse(value) - now;
  return Math.max(
    Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
    Math.min(8000, 500 * 2 ** attempt) * (0.5 + random()),
  );
}
/** Retries only rejected HTTP requests, never a successfully received result. */
export async function providerFetch(
  input: string,
  init: RequestInit,
  options: {
    deadline?: number;
    onAttempt?: (duration: number, status: number) => void;
    onBackoff?: (duration: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<Response> {
  const now = options.now ?? (() => performance.now());
  const deadline = options.deadline ?? now() + 60000;
  const attempts: { duration_ms: number; status: number }[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = now();
    let response: Response;
    try {
      response = await fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(Math.max(1, Math.floor(deadline - now()))),
        ]),
      });
    } catch (error) {
      options.onAttempt?.(now() - start, 0);
      throw error;
    }
    attempts.push({ duration_ms: now() - start, status: response.status });
    options.onAttempt?.(now() - start, response.status);
    if (response.ok) return response;
    const delay = retryDelay(response.headers.get('retry-after'), attempt);
    await response.body?.cancel();
    if (
      !(response.status === 429 || response.status >= 500) ||
      attempt === 2 ||
      now() + delay + 1000 >= deadline
    )
      throw new ProviderError(response.status, delay, attempts);
    const waiting = now();
    try {
      await (options.sleep ?? ((ms) => abortableDelay(ms, init.signal)))(delay);
    } finally {
      options.onBackoff?.(now() - waiting);
    }
  }
  throw new Error('UNREACHABLE');
}
/** A failing lane stops new work; already running lanes always drain and persist. */
export async function boundedPages<T>(
  items: T[],
  concurrency: number,
  budget: WorkBudget,
  work: (item: T) => Promise<boolean>,
): Promise<void> {
  let cursor = 0;
  let stopped = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!stopped && cursor < items.length && budget.canStart()) {
        const item = items[cursor++];
        try {
          if (!(await work(item))) stopped = true;
        } catch (error) {
          stopped = true;
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
}

async function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
