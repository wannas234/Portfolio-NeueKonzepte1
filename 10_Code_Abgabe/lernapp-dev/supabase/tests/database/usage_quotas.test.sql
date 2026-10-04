-- pgTAP-Tests für Nutzungskontingente (plan_limits, usage_events, consume_usage, Trigger).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Feste, kleine Grenzen für diesen Test; frühere lokale Läufe dürfen nicht mitzählen.
select public.configure_plan_limits('{
  "free": {"chat": 2, "search": 5, "search_per_minute": 2, "summary": 1, "flashcards": 1, "quizzes": 1,
           "material_analysis": 1, "upload": 2, "storage_bytes": 150},
  "pro":  {"chat": 4, "search": 50, "search_per_minute": 20, "summary": 5, "flashcards": 5, "quizzes": 5,
           "material_analysis": 5, "upload": 10, "storage_bytes": 100000}
}'::jsonb);
delete from public.usage_events
  where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.files where uploaded_by = '22222222-2222-2222-2222-222222222222';
delete from public.subscriptions
  where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- 1. Struktur und Rechte.
select has_table('public', 'plan_limits', 'plan_limits existiert');
select has_table('public', 'usage_events', 'usage_events existiert');
select has_trigger('public', 'summary_jobs', 'summary_jobs_usage_quota', 'Zusammenfassungen zählen');
select has_trigger('public', 'flashcard_jobs', 'flashcard_jobs_usage_quota', 'Karteikarten zählen');
select has_trigger('public', 'material_analyses', 'material_analyses_usage_quota', 'Analysen zählen');
select has_trigger('public', 'files', 'files_usage_quota', 'Uploads zählen');
select is(
  (select count(*)::integer from pg_constraint where conrelid = 'public.usage_events'::regclass
    and contype = 'f'),
  1, 'Verbrauch hängt nur am Profil, nicht an löschbaren Chats, Jobs oder Dateien');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$select public.consume_usage(auth.uid(), 'chat', 'x')$$, '42501', null,
  'Clients können keinen Verbrauch buchen');
select throws_ok($$select public.configure_plan_limits('{}')$$, '42501', null,
  'Clients können keine Limits setzen');
select throws_ok($$insert into public.usage_events(user_id, kind, key, plan)
  values (auth.uid(), 'chat', 'x', 'free')$$, '42501', null, 'Clients können nicht direkt schreiben');
select throws_ok($$update public.plan_limits set value = 999999$$, '42501', null,
  'Clients können Limits nicht ändern');
select is((select count(*)::integer from public.plan_limits), 18, 'Limits sind für Clients lesbar');
reset role;

-- 2. Monatskontingent, Idempotenz, Tarif.
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r1') ->> 'allowed',
  'true', 'Erste Chatnachricht erlaubt');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r1') ->> 'replay',
  'true', 'Wiederholung derselben request_id zählt nicht erneut');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r2') ->> 'used',
  '2', 'Zweite Nachricht ist die letzte im Gratis-Kontingent');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r3') ->> 'code',
  'QUOTA_EXCEEDED', 'Dritte Nachricht überschreitet das Gratis-Kontingent');
select is((select count(*)::integer from public.usage_events
  where user_id = '22222222-2222-2222-2222-222222222222'), 2, 'Abgelehnte Aktion wird nicht gebucht');

update public.usage_events set created_at = public.usage_period_start() - interval '1 second'
  where user_id = '22222222-2222-2222-2222-222222222222' and key = 'r1';
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r3') ->> 'allowed',
  'true', 'Verbrauch aus dem Vormonat zählt nicht');

insert into public.subscriptions(user_id, status) values ('22222222-2222-2222-2222-222222222222', 'active');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r4') ->> 'plan',
  'pro', 'Aktives Abo nutzt das Pro-Kontingent');
update public.subscriptions set status = 'past_due' where user_id = '22222222-2222-2222-2222-222222222222';
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r5') ->> 'plan',
  'pro', 'Zahlungsfehler: Pro bleibt während der Schonfrist');
select ok((select past_due_since > now() - interval '1 minute' from public.subscriptions
  where user_id = '22222222-2222-2222-2222-222222222222'), 'Schonfrist beginnt beim Wechsel nach past_due');

alter table public.subscriptions disable trigger subscriptions_track_past_due;
update public.subscriptions set past_due_since = now() - interval '6 days'
  where user_id = '22222222-2222-2222-2222-222222222222';
alter table public.subscriptions enable trigger subscriptions_track_past_due;
update public.subscriptions set cancel_at_period_end = false
  where user_id = '22222222-2222-2222-2222-222222222222';
select ok((select past_due_since < now() - interval '5 days' from public.subscriptions
  where user_id = '22222222-2222-2222-2222-222222222222'), 'Weitere past_due-Events setzen die Frist nicht zurück');
select is(public.current_plan('22222222-2222-2222-2222-222222222222'), 'pro', 'Tag 6: noch Pro');

alter table public.subscriptions disable trigger subscriptions_track_past_due;
update public.subscriptions set past_due_since = now() - interval '7 days 1 second'
  where user_id = '22222222-2222-2222-2222-222222222222';
alter table public.subscriptions enable trigger subscriptions_track_past_due;
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'chat', 'r6') ->> 'code',
  'QUOTA_EXCEEDED', 'Nach der Schonfrist gilt wieder das Gratis-Kontingent');

update public.subscriptions set status = 'active' where user_id = '22222222-2222-2222-2222-222222222222';
select is((select past_due_since from public.subscriptions
  where user_id = '22222222-2222-2222-2222-222222222222'), null, 'Erfolgreiche Zahlung beendet die Schonfrist');
update public.subscriptions set status = 'unpaid' where user_id = '22222222-2222-2222-2222-222222222222';
select is(public.current_plan('22222222-2222-2222-2222-222222222222'), 'free', 'unpaid ist free');
update public.subscriptions set status = 'canceled' where user_id = '22222222-2222-2222-2222-222222222222';
select is(public.current_plan('22222222-2222-2222-2222-222222222222'), 'free', 'canceled ist free');
delete from public.subscriptions where user_id = '22222222-2222-2222-2222-222222222222';

-- 2b. Verbrauchsübersicht für den angemeldeten Nutzer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.get_my_usage() ->> 'plan', 'free', 'Übersicht nennt den Tarif');
select is(public.get_my_usage() #>> '{usage,chat,used}', '4', 'Übersicht zählt nur den laufenden Monat');
select is(public.get_my_usage() #>> '{usage,chat,limit}', '2', 'Übersicht nennt das eigene Limit');
select is(public.get_my_usage() #>> '{usage,chat,pro_limit}', '4', 'Übersicht nennt das Pro-Limit');
select is(public.get_my_usage() #>> '{usage,summary,used}', '0', 'Ungenutzte Arten zählen 0');
select is(public.get_my_usage() -> 'usage' ? 'search_per_minute', false, 'Minutenlimit ist kein Monatszähler');
select is(public.get_my_usage() #>> '{storage,limit_bytes}', '150', 'Speicherlimit enthalten');
select ok((public.get_my_usage() ->> 'resets_at')::timestamptz > now(), 'Reset liegt in der Zukunft');
select is(public.get_my_usage() ->> 'grace_until', null, 'Ohne Zahlungsfehler keine Schonfrist');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.get_my_usage() #>> '{usage,chat,used}', '0', 'Fremder Verbrauch ist nicht sichtbar');
reset role;
set local role anon;
select throws_ok($$select public.get_my_usage()$$, '42501', null, 'Anonym gibt es keine Übersicht');
reset role;

-- 3. Suche: Minutenlimit zusätzlich zum Monatskontingent.
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'search', 's1') ->> 'allowed', 'true', 'Suche 1');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'search', 's2') ->> 'allowed', 'true', 'Suche 2');
select is(public.consume_usage('22222222-2222-2222-2222-222222222222', 'search', 's3') ->> 'code',
  'RATE_LIMITED', 'Dritte Suche in derselben Minute wird gebremst');
select ok((public.consume_usage('22222222-2222-2222-2222-222222222222', 'search', 's3')
  ->> 'retry_after_seconds')::integer between 1 and 60, 'Wartezeit wird mitgeliefert');

-- 4. Uploads: Anzahl und Gesamtspeicher, auch beim direkten RPC-Aufruf.
insert into public.courses(id, owner_id, title) values
  ('93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Quota test');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$select public.prepare_file_upload('93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000010', 'a.txt', 'text/plain', 100)$$, 'Erster Upload');
select lives_ok($$select public.prepare_file_upload('93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000010', 'a.txt', 'text/plain', 100)$$,
  'Retry mit demselben Upload-Key bucht nicht erneut');
select throws_ok($$select public.prepare_file_upload('93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000011', 'b.txt', 'text/plain', 51)$$, 'P0001',
  'STORAGE_QUOTA_EXCEEDED', 'Gesamtspeicher wird geprüft (offene Uploads zählen mit)');
select lives_ok($$select public.prepare_file_upload('93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000012', 'c.txt', 'text/plain', 50)$$, 'Zweiter Upload passt genau');
reset role;
delete from public.files where uploaded_by = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$select public.prepare_file_upload('93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000013', 'd.txt', 'text/plain', 10)$$, 'P0001', 'QUOTA_EXCEEDED',
  'Löschen gibt Speicher frei, aber nicht das monatliche Upload-Kontingent');
reset role;

-- 5. Job-Trigger: neue Jobs zählen, abgelehnte werden nicht angelegt.
insert into public.material_analyses(owner_id, material_id, request_id, context, source_hash) values
  ('11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000004',
   gen_random_uuid(), '{}', 'h1');
select is((select count(*)::integer from public.usage_events
  where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'material_analysis'), 1,
  'Neue Analyse wird gebucht');
select throws_ok($$insert into public.material_analyses(owner_id, material_id, request_id, context,
  source_hash) values ('11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000004',
  gen_random_uuid(), '{}', 'h2')$$, 'P0001', 'QUOTA_EXCEEDED', 'Analyse über Kontingent abgelehnt');
select is((select count(*)::integer from public.material_analyses
  where owner_id = '11111111-1111-1111-1111-111111111111' and source_hash = 'h2'), 0,
  'Abgelehnte Analyse wird nicht angelegt');

-- 6. Verbrauch überlebt gelöschte Inhalte.
delete from public.material_analyses where owner_id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::integer from public.usage_events
  where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'material_analysis'), 1,
  'Gelöschte Analyse gibt das Kontingent nicht zurück');

-- 7. Konfiguration wird streng geprüft.
select throws_ok($$select public.configure_plan_limits('{"free": {}}')$$, '22023', 'INVALID_PLAN_LIMITS',
  'Fehlender Tarif wird abgelehnt');
select throws_ok($$select public.configure_plan_limits(
  jsonb_set((select jsonb_object_agg(plan, l) from (select plan, jsonb_object_agg(kind, value) l
    from public.plan_limits group by plan) t), '{pro,chat}', '-1'))$$, '22023', 'INVALID_PLAN_LIMITS',
  'Negative Grenze wird abgelehnt');
select throws_ok($$select public.configure_plan_limits(
  jsonb_set((select jsonb_object_agg(plan, l) from (select plan, jsonb_object_agg(kind, value) l
    from public.plan_limits group by plan) t), '{pro,chat}', '"10"'))$$, '22023', 'INVALID_PLAN_LIMITS',
  'Text statt Zahl wird abgelehnt');
select is((select value from public.plan_limits where plan = 'pro' and kind = 'chat'), 4::bigint,
  'Abgelehnte Konfiguration ändert nichts');

select * from finish();
rollback;
