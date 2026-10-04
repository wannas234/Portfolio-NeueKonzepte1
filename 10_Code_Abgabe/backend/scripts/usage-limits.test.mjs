import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../supabase/usage-limits.mjs';
import { planLimits, planLimitsSql } from './usage-limits.mjs';

test('usage-limits.mjs ist gültig und wird in DB-Arten übersetzt', () => {
  const limits = planLimits();
  assert.deepEqual(Object.keys(limits).sort(), ['free', 'pro']);
  for (const plan of ['free', 'pro']) {
    assert.deepEqual(Object.keys(limits[plan]).sort(), [
      'chat',
      'flashcards',
      'material_analysis',
      'quizzes',
      'search',
      'search_per_minute',
      'storage_bytes',
      'summary',
      'upload',
    ]);
    assert.equal(limits[plan].storage_bytes, config[plan].storageMegabytes * 1024 * 1024);
    assert.equal(limits[plan].chat, config[plan].chatMessagesPerMonth);
  }
});

test('Tippfehler und ungültige Werte brechen ab statt still unbegrenzt zu gelten', () => {
  const valid = structuredClone(config);
  const broken = [
    { free: valid.free },
    { ...valid, team: valid.pro },
    { ...valid, free: { ...valid.free, chatMessagesPerMonth: undefined } },
    { ...valid, free: { ...valid.free, chatMesagesPerMonth: 1 } },
    { ...valid, pro: { ...valid.pro, uploadsPerMonth: -1 } },
    { ...valid, pro: { ...valid.pro, uploadsPerMonth: 1.5 } },
    { ...valid, pro: { ...valid.pro, uploadsPerMonth: '10' } },
    { ...valid, pro: { ...valid.pro, storageMegabytes: Number.MAX_SAFE_INTEGER } },
  ];
  for (const value of broken) assert.throws(() => planLimits(value), /usage-limits\.mjs/);
  assert.equal(
    planLimits({ ...valid, free: { ...valid.free, uploadsPerMonth: 0 } }).free.upload,
    0,
  );
});

test('SQL bettet nur validiertes JSON ein', () => {
  const sql = planLimitsSql();
  assert.match(sql, /^select public\.configure_plan_limits\('\{.*\}'::jsonb\);\n$/);
  assert.deepEqual(JSON.parse(sql.slice(sql.indexOf("'") + 1, sql.lastIndexOf("'"))), planLimits());
});
