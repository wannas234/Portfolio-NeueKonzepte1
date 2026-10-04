import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

test(
  'Concurrent checkout reservations and expiry rotations have one winner',
  { skip: process.env.LEARNING_DB_TEST !== '1' },
  async () => {
    const target = 'lernapp-learning-test';
    const inspect = JSON.parse(
      execFileSync('docker', ['inspect', target], { encoding: 'utf8' }),
    )[0];
    assert.equal(inspect.HostConfig.NetworkMode, 'none');
    const args = [
      'exec',
      '-i',
      target,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ];
    const user = '11111111-1111-1111-1111-111111111111';
    const sql = (query) => execFileSync('docker', [...args, '-c', query], { encoding: 'utf8' });
    const batch = (expired = 'null') =>
      Promise.all(
        Array.from({ length: 4 }, async (_, i) => {
          const query = `begin; select public.reserve_checkout_attempt('${user}', '{"customer":"cus_${i}"}', ${expired}); select pg_sleep(0.15); commit;`;
          const { stdout } = await promisify(execFile)('docker', [...args, '-c', query]);
          return JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')));
        }),
      );
    try {
      const first = await batch();
      for (const row of first) assert.deepEqual(row, first[0]);
      sql(
        `update public.checkout_attempts set stripe_session_id='cs_expired' where user_id='${user}'`,
      );
      const renewed = await batch(`'${first[0].id}'`);
      assert.notEqual(renewed[0].id, first[0].id);
      for (const row of renewed) assert.deepEqual(row, renewed[0]);
    } finally {
      sql(`delete from public.checkout_attempts where user_id='${user}'`);
    }
  },
);
