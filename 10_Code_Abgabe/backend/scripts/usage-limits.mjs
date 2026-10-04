import limits from '../supabase/usage-limits.mjs';

// Übersetzt supabase/usage-limits.mjs in das Format von public.configure_plan_limits.
// Lieber beim Deploy laut scheitern als Tippfehler stillschweigend als "unbegrenzt" werten.
const FIELDS = {
  chatMessagesPerMonth: 'chat',
  searchesPerMonth: 'search',
  searchesPerMinute: 'search_per_minute',
  summariesPerMonth: 'summary',
  flashcardGenerationsPerMonth: 'flashcards',
  quizGenerationsPerMonth: 'quizzes',
  materialAnalysesPerMonth: 'material_analysis',
  uploadsPerMonth: 'upload',
  storageMegabytes: 'storage_bytes',
};
const PLANS = ['free', 'pro'];
const MEGABYTE = 1024 * 1024;

export function planLimits(config = limits) {
  const keys = (value) => Object.keys(value ?? {}).sort();
  if (keys(config).join() !== [...PLANS].sort().join())
    throw new Error(`usage-limits.mjs: genau die Tarife ${PLANS.join(', ')} erwartet.`);
  const result = {};
  for (const plan of PLANS) {
    const values = config[plan];
    const expected = Object.keys(FIELDS).sort();
    if (keys(values).join() !== expected.join())
      throw new Error(`usage-limits.mjs: Tarif "${plan}" braucht genau ${expected.join(', ')}.`);
    result[plan] = {};
    for (const [field, kind] of Object.entries(FIELDS)) {
      const value = values[field];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`usage-limits.mjs: ${plan}.${field} muss eine ganze Zahl >= 0 sein.`);
      const stored = kind === 'storage_bytes' ? value * MEGABYTE : value;
      if (!Number.isSafeInteger(stored))
        throw new Error(`usage-limits.mjs: ${plan}.${field} ist zu groß.`);
      result[plan][kind] = stored;
    }
  }
  return result;
}

// Nur Zahlen und feste Schlüssel: Das JSON kann gefahrlos als SQL-Literal eingebettet werden.
export function planLimitsSql(config = limits) {
  return `select public.configure_plan_limits('${JSON.stringify(planLimits(config))}'::jsonb);\n`;
}
