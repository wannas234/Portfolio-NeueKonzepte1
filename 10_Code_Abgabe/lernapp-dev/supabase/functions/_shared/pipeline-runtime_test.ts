import {
  boundedPages,
  WorkBudget,
  providerFetch,
  ProviderError,
  retryDelay,
} from './pipeline-runtime.ts';
const assert = (v: unknown, m = 'Assertion failed') => {
  if (!v) throw new Error(m);
};
Deno.test(
  'Parallel pages cap concurrency, drain successes after partial failure, and never detach promises',
  async () => {
    let running = 0,
      max = 0;
    const saved: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const task = boundedPages([1, 2, 3, 4, 5], 3, new WorkBudget(75000), async (n) => {
      running++;
      max = Math.max(max, running);
      await gate;
      running--;
      if (n === 2) throw new Error('partial');
      saved.push(n);
      return true;
    });
    assert(running === 3);
    release();
    let failed = false;
    try {
      await task;
    } catch {
      failed = true;
    }
    assert(failed && max === 3 && running === 0 && saved.includes(1) && saved.includes(3));
  },
);
Deno.test('Budget stops issuing pages and a quota miss does not spin', async () => {
  let now = 0,
    calls = 0;
  const budget = new WorkBudget(30000, () => now);
  await boundedPages([1, 2, 3, 4], 1, budget, () => {
    calls++;
    now += 16000;
    return Promise.resolve(true);
  });
  assert(calls === 1 && !budget.canStart());
  calls = 0;
  await boundedPages([1, 2, 3, 4], 1, new WorkBudget(30000), () => {
    calls++;
    return Promise.resolve(false);
  });
  assert(calls === 1);
});
Deno.test(
  'HTTP 429/5xx retries are bounded, respect Retry-After and do not retry success/4xx',
  async () => {
    const original = globalThis.fetch;
    try {
      for (const status of [429, 503, 400, 200]) {
        let calls = 0;
        const sleeps: number[] = [];
        globalThis.fetch = () => {
          calls++;
          return Promise.resolve(new Response(null, { status, headers: { 'retry-after': '2' } }));
        };
        try {
          await providerFetch(
            'https://fake.invalid',
            {},
            {
              sleep: (ms) => {
                sleeps.push(ms);
                return Promise.resolve();
              },
            },
          );
        } catch (error) {
          assert(error instanceof ProviderError);
        }
        assert(calls === (status === 429 || status === 503 ? 3 : 1));
        assert(sleeps.every((ms) => ms >= 2000));
      }
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(
          new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
        );
      };
      try {
        await providerFetch(
          'https://fake.invalid',
          {},
          {
            deadline: 100,
            now: () => 0,
            sleep: () => {
              throw new Error('must yield');
            },
          },
        );
      } catch (error) {
        assert(error instanceof ProviderError && error.retryAfterMs >= 120000);
      }
      assert(calls === 1);
      assert(retryDelay(new Date(5000).toUTCString(), 0, 0, () => 0) === 5000);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  'Budget abort cancels backoff promptly without a detached timer or another paid request',
  async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(
          new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
        );
      };
      let aborted = false;
      try {
        await providerFetch('https://fake.invalid', { signal: AbortSignal.timeout(1) });
      } catch (error) {
        aborted = error instanceof DOMException;
      }
      assert(aborted && calls === 1);
    } finally {
      globalThis.fetch = original;
    }
  },
);
