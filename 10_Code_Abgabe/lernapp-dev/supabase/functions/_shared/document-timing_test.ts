import { createClient } from '@supabase/supabase-js';
import { withDocumentTiming } from './document-timing.ts';

Deno.test(
  'Timing writes failing must preserve results and original processing errors',
  async () => {
    for (const throws of [false, true]) {
      let writes = 0;
      const admin = createClient('http://supabase.test', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: () => {
            writes++;
            if (throws) throw new Error('Network unavailable');
            return Promise.resolve(Response.json({ message: 'Unavailable' }, { status: 503 }));
          },
        },
      });
      const result = await withDocumentTiming(admin, 'doc', 'extraction', null, async (timing) => {
        const text = await timing.measure('text_extraction', () => 'full text');
        timing.outcome = 'completed';
        return text;
      });
      if (result !== 'full text' || writes !== 2) throw new Error('Telemetry changed success');
      const original = new Error('Extraction error');
      let caught: unknown;
      try {
        await withDocumentTiming(admin, 'doc', 'extraction', null, (timing) =>
          timing.measure('text_extraction', () => {
            throw original;
          }),
        );
      } catch (error) {
        caught = error;
      }
      if (caught !== original) throw new Error('Telemetry masked processing failure');
    }
  },
);
