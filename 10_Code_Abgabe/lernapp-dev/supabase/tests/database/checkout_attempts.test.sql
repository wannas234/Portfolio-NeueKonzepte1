begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public', 'checkout_attempts', 'Checkout attempts table exists');
select is((select relrowsecurity from pg_class where oid='public.checkout_attempts'::regclass), true, 'RLS enabled');
select ok(not has_table_privilege('authenticated','public.checkout_attempts','SELECT'), 'No client reads');
select ok(not has_table_privilege('authenticated','public.checkout_attempts','INSERT'), 'No client writes');
select ok(not has_function_privilege('authenticated','public.reserve_checkout_attempt(uuid,jsonb,uuid,text)','EXECUTE'), 'No client rotation');
select ok(not has_function_privilege('anon','public.reserve_checkout_attempt(uuid,jsonb,uuid,text)','EXECUTE'), 'No anonymous reservation');
select ok(has_function_privilege('service_role','public.reserve_checkout_attempt(uuid,jsonb,uuid,text)','EXECUTE'), 'Server reservation allowed');
create temp table initial_attempt as select public.reserve_checkout_attempt(
  '11111111-1111-1111-1111-111111111111', '{"customer":"cus_one"}') as a;
select is(public.reserve_checkout_attempt('11111111-1111-1111-1111-111111111111', '{"customer":"changed"}'),
  (select a from initial_attempt), 'Retries preserve id and payload');
select is(public.reserve_checkout_attempt('11111111-1111-1111-1111-111111111111', '{}', (select (a->>'id')::uuid from initial_attempt)),
  (select a from initial_attempt), 'Unresolved attempt cannot rotate');
update public.checkout_attempts set stripe_session_id='cs_expired' where user_id='11111111-1111-1111-1111-111111111111';
create temp table renewed_attempt as select public.reserve_checkout_attempt(
  '11111111-1111-1111-1111-111111111111','{"customer":"cus_two"}', (select (a->>'id')::uuid from initial_attempt)) as a;
select isnt((select a->>'id' from renewed_attempt), (select a->>'id' from initial_attempt), 'Expired session rotates key');
select is((select a->'parameters' from renewed_attempt), '{"customer":"cus_two"}'::jsonb, 'New parameters after expiry');
select is(public.reserve_checkout_attempt('11111111-1111-1111-1111-111111111111', '{}', (select (a->>'id')::uuid from initial_attempt)),
  (select a from renewed_attempt), 'Stale concurrent rotation reuses winner');
select is(public.reserve_checkout_attempt('22222222-2222-2222-2222-222222222222', '{}', null, 'cs_legacy')->>'stripe_session_id',
  'cs_legacy', 'Legacy checkout is bound atomically');
select is(public.reserve_checkout_attempt('22222222-2222-2222-2222-222222222222', '{}', null, 'cs_other')->>'stripe_session_id',
  'cs_legacy', 'Concurrent legacy discovery cannot overwrite the bound session');
select is(public.reserve_checkout_attempt('11111111-1111-1111-1111-111111111111', '{}', null, 'cs_other')->>'stripe_session_id',
  null::text, 'Legacy discovery cannot take over an already reserved creation key');
select * from finish();
rollback;
