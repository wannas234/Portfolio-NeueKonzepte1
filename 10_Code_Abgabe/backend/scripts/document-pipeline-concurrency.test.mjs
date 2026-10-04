// Explicit integration test: never targets the ordinary development container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const container = 'lernapp-pipeline-test';
const args = [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-At',
];
const sql = (query) => execFileSync('docker', [...args, '-c', query], { encoding: 'utf8' }).trim();
const asyncSql = async (query) =>
  (await promisify(execFile)('docker', [...args, '-c', query])).stdout.trim();
test(
  'Concurrent page commits merge under lock; project semaphore caps different documents',
  { skip: process.env.PIPELINE_DB_TEST !== '1' },
  async () => {
    const course = '95100000-0000-0000-0000-000000000001';
    const owner = '11111111-1111-1111-1111-111111111111';
    const ids = [];
    // Isolated container only: slots of deleted test documents otherwise live for 90 s
    // and window reservations for one minute, which would make back-to-back runs flaky.
    const resetProviderState = () =>
      sql(
        `delete from public.document_provider_slots; update public.document_provider_limits set starts=0, window_start=now(), blocked_until='-infinity'`,
      );
    resetProviderState();
    try {
      sql(
        `insert into public.courses(id,owner_id,title) values('${course}','${owner}','Isolated pipeline concurrency test')`,
      );
      for (let n = 0; n < 2; n++) {
        const file = JSON.parse(
          sql(
            `set request.jwt.claims='{"sub":"${owner}","role":"authenticated"}'; select to_jsonb(public.prepare_file_upload('${course}',gen_random_uuid(),'test.pdf','application/pdf',500))`,
          )
            .split('\n')
            .at(-1),
        ).id;
        const complete = JSON.parse(
          sql(`select public.complete_file_upload('${file}','${owner}')`),
        );
        const id = complete.source_document.id;
        const claim = JSON.parse(sql(`select public.claim_document_processing('${id}')`));
        ids.push({ id, token: claim.lease_token });
        sql(
          `select public.save_document_processing_checkpoint('${id}','${claim.lease_token}','{"version":"visual-blocks-v1","model":"gemini-3.6-flash","pages":[{"page":1,"text":"","route":"visual"},{"page":2,"text":"","route":"visual"}]}',false)`,
        );
      }
      const { id, token } = ids[0];
      await Promise.all(
        [1, 2].map((n) =>
          asyncSql(
            `begin; select public.save_document_processing_page('${id}','${token}','{"page":${n},"text":"page ${n}","route":"visual","extraction":{}}'); select pg_sleep(0.1); commit;`,
          ),
        ),
      );
      const pages = JSON.parse(
        sql(
          `select checkpoint->'pages' from public.document_processing_jobs where document_id='${id}'`,
        ),
      );
      assert.deepEqual(
        pages.map((p) => p.text),
        ['page 1', 'page 2'],
      );
      const slots = await Promise.all(
        Array.from({ length: 10 }, (_, n) => {
          const d = ids[n % 2];
          return asyncSql(
            `select public.acquire_document_provider_slot('visual','${d.id}','${d.token}')`,
          );
        }),
      );
      assert.equal(slots.filter(Boolean).length, 3);
      sql(
        `update public.document_provider_slots set expires_at=now()-interval '1 second' where token='${slots.find(Boolean)}'`,
      );
      assert.ok(
        sql(
          `select public.acquire_document_provider_slot('visual','${ids[1].id}','${ids[1].token}')`,
        ),
        'Expired slot can be reclaimed',
      );
      // Finish one document while its simulated visual requests still occupy slots.
      sql(
        `select public.finish_document_processing('${id}','${token}','page 1\n\npage 2',(select checkpoint->'pages' from public.document_processing_jobs where document_id='${id}'))`,
      );
      sql(`update public.document_indexing_jobs set available_at=now() where document_id='${id}'`);
      const indexing = JSON.parse(sql(`select public.claim_document_indexing('${id}')`));
      assert.equal(
        sql(
          `select public.acquire_document_provider_slot('embedding','${id}','${indexing.lease_token}')`,
        ),
        '',
        'Embedding plus visual calls share the global cap',
      );
      sql(
        `select public.release_document_provider_slot(token) from public.document_provider_slots where document_id in ('${ids[0].id}','${ids[1].id}')`,
      );
      assert.ok(
        sql(
          `select public.acquire_document_provider_slot('embedding','${id}','${indexing.lease_token}')`,
        ),
      );
    } finally {
      sql(`delete from public.courses where id='${course}'`);
      resetProviderState();
    }
  },
);
