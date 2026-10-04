import { isWorkerRequest } from './worker-auth.ts';

Deno.test('Worker authentication separates scheduler credentials from runtime credentials', () => {
  const names = ['WORKER_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = names.map((name) => Deno.env.get(name));
  const accepts = (token: string) =>
    isWorkerRequest(
      new Request('http://local', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  try {
    names.forEach((name) => Deno.env.delete(name));
    if (accepts('undefined')) throw new Error('Missing configuration accepted');
    Deno.env.set(names[1], 'runtime-key');
    if (!accepts('runtime-key')) throw new Error('Local fallback broken');
    Deno.env.set(names[0], 'scheduler-key');
    if (!accepts('scheduler-key')) throw new Error('Configured scheduler rejected');
    for (const token of ['runtime-key', 'user-token', 'wrong-key']) {
      if (accepts(token)) throw new Error('Unconfigured token accepted');
    }
    if (isWorkerRequest(new Request('http://local'))) throw new Error('Anonymous accepted');
  } finally {
    names.forEach((name, i) =>
      previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
    );
  }
});
