-- pgTAP-Tests für public.subscriptions und public.stripe_events.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. Struktur und RLS.
select has_table('public', 'subscriptions', 'Tabelle subscriptions existiert');
select has_table('public', 'stripe_events', 'Tabelle stripe_events existiert');
select col_is_pk('public', 'subscriptions', 'user_id', 'subscriptions: user_id ist Primary Key');
select col_is_pk('public', 'stripe_events', 'event_id', 'stripe_events: event_id ist Primary Key');
select col_is_unique('public', 'subscriptions', 'stripe_customer_id', 'stripe_customer_id ist unique');
select col_is_unique('public', 'subscriptions', 'stripe_subscription_id', 'stripe_subscription_id ist unique');
select col_not_null('public', 'subscriptions', 'status', 'status ist NOT NULL');
select col_not_null('public', 'stripe_events', 'event_type', 'event_type ist NOT NULL');
select is((select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass), true, 'subscriptions: RLS aktiviert');
select is((select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass), true, 'stripe_events: RLS aktiviert');
select policies_are('public', 'subscriptions', array['subscriptions_select_own'], 'subscriptions: genau eine Policy (SELECT eigene)');
select policies_are('public', 'stripe_events', array[]::text[], 'stripe_events: keine Policies');

-- 2. Constraints (als Superuser, RLS umgangen).
select throws_ok($$
  insert into public.subscriptions(user_id, status)
  values ('99300000-0000-0000-0000-000000000099', 'active')
$$, '23503', null, 'Unbekannter user_id wird abgewiesen (FK)');

insert into public.subscriptions(user_id, status, stripe_customer_id, stripe_subscription_id, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'active', 'cus_anna', 'sub_anna', '2000-01-01 00:00:00+00'),
  ('22222222-2222-2222-2222-222222222222', 'trialing', 'cus_ben', 'sub_ben', now());

select throws_ok($$
  insert into public.subscriptions(user_id, status) values ('11111111-1111-1111-1111-111111111111', 'active')
$$, '23505', null, 'Pro Nutzer nur eine Subscription (PK)');

insert into auth.users (id) values ('99300000-0000-0000-0000-000000000001');
select throws_ok($$
  insert into public.subscriptions(user_id, status, stripe_customer_id)
  values ('99300000-0000-0000-0000-000000000001', 'active', 'cus_anna')
$$, '23505', null, 'stripe_customer_id muss eindeutig sein');
select throws_ok($$
  insert into public.subscriptions(user_id, status, stripe_subscription_id)
  values ('99300000-0000-0000-0000-000000000001', 'active', 'sub_anna')
$$, '23505', null, 'stripe_subscription_id muss eindeutig sein');
select throws_ok($$
  insert into public.subscriptions(user_id, status) values ('99300000-0000-0000-0000-000000000001', null)
$$, '23502', null, 'status darf nicht NULL sein');

select is(
  (select cancel_at_period_end from public.subscriptions where user_id = '11111111-1111-1111-1111-111111111111'),
  false, 'cancel_at_period_end ist standardmäßig false'
);

update public.subscriptions set status = 'past_due' where user_id = '11111111-1111-1111-1111-111111111111';
select isnt(
  (select updated_at::text from public.subscriptions where user_id = '11111111-1111-1111-1111-111111111111'),
  '2000-01-01 00:00:00+00', 'updated_at wird vom Trigger gepflegt'
);

insert into public.stripe_events(event_id, event_type) values ('evt_1', 'checkout.session.completed');
select throws_ok($$
  insert into public.stripe_events(event_id, event_type) values ('evt_1', 'checkout.session.completed')
$$, '23505', null, 'Doppeltes Event wird abgewiesen (Idempotenz)');
select throws_ok($$
  insert into public.stripe_events(event_id, event_type) values ('evt_2', null)
$$, '23502', null, 'event_type darf nicht NULL sein');

-- Löschen des Auth-Users entfernt die Subscription (on delete cascade).
insert into public.subscriptions(user_id, status) values ('99300000-0000-0000-0000-000000000001', 'active');
delete from auth.users where id = '99300000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.subscriptions where user_id = '99300000-0000-0000-0000-000000000001'),
  0, 'Subscription wird mit dem Auth-User gelöscht (cascade)'
);

-- 3. RLS aus Sicht von Anna.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.subscriptions), 1, 'Anna sieht nur eine Subscription');
select is(
  (select stripe_customer_id from public.subscriptions), 'cus_anna', 'Anna sieht ihre eigene Subscription'
);
select is(
  (select count(*)::int from public.subscriptions where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'Anna sieht Bens Subscription nicht'
);
select throws_ok($$
  insert into public.subscriptions(user_id, status) values ('11111111-1111-1111-1111-111111111111', 'active')
$$, '42501', null, 'Nutzer kann keine Subscription anlegen');
select throws_ok($$
  update public.subscriptions set status = 'active' where user_id = '11111111-1111-1111-1111-111111111111'
$$, '42501', null, 'Nutzer kann die eigene Subscription nicht ändern');
select throws_ok($$
  delete from public.subscriptions where user_id = '11111111-1111-1111-1111-111111111111'
$$, '42501', null, 'Nutzer kann die eigene Subscription nicht löschen');
select throws_ok($$select * from public.stripe_events$$, '42501', null, 'Nutzer kann stripe_events nicht lesen');
select throws_ok($$
  insert into public.stripe_events(event_id, event_type) values ('evt_x', 'x')
$$, '42501', null, 'Nutzer kann stripe_events nicht schreiben');

-- 4. Anonyme Zugriffe.
reset role;
set local role anon;
select throws_ok($$select * from public.subscriptions$$, '42501', null, 'Anonym: kein Zugriff auf subscriptions');
select throws_ok($$select * from public.stripe_events$$, '42501', null, 'Anonym: kein Zugriff auf stripe_events');

-- 5. service_role (Webhook) darf lesen und schreiben.
reset role;
set local role service_role;
select lives_ok($$
  insert into public.stripe_events(event_id, event_type) values ('evt_svc', 'customer.subscription.updated')
$$, 'service_role kann stripe_events schreiben');
select lives_ok($$
  update public.subscriptions set cancel_at_period_end = true where user_id = '22222222-2222-2222-2222-222222222222'
$$, 'service_role kann subscriptions ändern');
select is((select count(*)::int from public.subscriptions), 2, 'service_role sieht alle Subscriptions');
reset role;

select * from finish();
rollback;
