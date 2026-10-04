begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.courses(id,owner_id,title) values
 ('99000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Calendar test (own)');
insert into public.courses(id,owner_id,title) values
 ('99000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Calendar test (foreign)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($$
  insert into public.calendar_events(id,owner_id,course_id,title,kind,starts_at)
  values ('99000000-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','99000000-0000-0000-0000-000000000001','Vorlesung','lecture','2026-10-12 09:00+00')
$$,'Owner can create an event on their own course');

select lives_ok($$
  insert into public.calendar_events(id,owner_id,title,kind,starts_at)
  values ('99000000-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','Private Erinnerung','deadline','2026-10-28 18:00+00')
$$,'Owner can create a private event without a course');

select throws_ok($$
  insert into public.calendar_events(id,owner_id,course_id,title,kind,starts_at)
  values ('99000000-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','99000000-0000-0000-0000-000000000002','Fremdkurs','lecture','2026-10-12 09:00+00')
$$,'42501',null,'Cannot attach an event to a foreign course');

select throws_ok($$
  insert into public.calendar_events(id,owner_id,title,kind,starts_at)
  values ('99000000-0000-0000-0000-000000000013','22222222-2222-2222-2222-222222222222','Untergeschoben','deadline','2026-10-28 18:00+00')
$$,'42501',null,'Cannot create an event owned by someone else');

select is((select count(*)::int from public.calendar_events where id in ('99000000-0000-0000-0000-000000000010','99000000-0000-0000-0000-000000000011')),2,'Owner sees both of their events');

select is((select ends_at from public.calendar_events where id='99000000-0000-0000-0000-000000000011'),null,'ends_at bleibt NULL wenn nicht gesetzt');
select is((select all_day from public.calendar_events where id='99000000-0000-0000-0000-000000000010'),false,'all_day ist standardmaessig false');

select lives_ok($$
  insert into public.calendar_events(id,owner_id,title,kind,starts_at,ends_at,all_day)
  values ('99000000-0000-0000-0000-000000000021','11111111-1111-1111-1111-111111111111','Feiertag','other','2026-11-01 00:00+00','2026-11-02 00:00+00',true)
$$,'Ein ganztaegiger Termin kann angelegt werden');
select is((select all_day from public.calendar_events where id='99000000-0000-0000-0000-000000000021'),true,'all_day wird korrekt gespeichert');
select lives_ok($$
  update public.calendar_events set all_day=false where id='99000000-0000-0000-0000-000000000021'
$$,'all_day ist per Update aenderbar');

select lives_ok($$
  insert into public.calendar_events(id,owner_id,title,kind,starts_at,ends_at)
  values ('99000000-0000-0000-0000-000000000020','11111111-1111-1111-1111-111111111111','Workshop','exercise','2026-11-02 09:00+00','2026-11-02 11:00+00')
$$,'Ein gueltiger Endzeitpunkt nach dem Start wird gespeichert');
select is((select ends_at from public.calendar_events where id='99000000-0000-0000-0000-000000000020'),'2026-11-02 11:00+00'::timestamptz,'Der gespeicherte Endzeitpunkt entspricht der Eingabe');

select throws_ok($$
  insert into public.calendar_events(owner_id,title,kind,starts_at,ends_at)
  values ('11111111-1111-1111-1111-111111111111','Ungueltig','exercise','2026-11-02 11:00+00','2026-11-02 09:00+00')
$$,'23514',null,'Ein Ende vor dem Start wird abgewiesen');
select throws_ok($$
  insert into public.calendar_events(owner_id,title,kind,starts_at,ends_at)
  values ('11111111-1111-1111-1111-111111111111','Ungueltig','exercise','2026-11-02 09:00+00','2026-11-02 09:00+00')
$$,'23514',null,'Ein Ende gleich dem Start wird abgewiesen');

reset role;
set local role anon;
select throws_ok($$select * from public.calendar_events$$,'42501',null,'Anonymous select is denied');
select throws_ok($$
  insert into public.calendar_events(owner_id,title,kind,starts_at)
  values ('11111111-1111-1111-1111-111111111111','Anon','other','2026-11-02 09:00+00')
$$,'42501',null,'Anonymous insert is denied');
reset role;
update public.calendar_events
set updated_at = '2000-01-01 00:00:00+00'
where id = '99000000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  update public.calendar_events set description='Aktualisiert' where id='99000000-0000-0000-0000-000000000010'
$$,'Ein Update loest den updated_at-Trigger aus');
select isnt(
  (select updated_at::text from public.calendar_events where id='99000000-0000-0000-0000-000000000010'),
  '2000-01-01 00:00:00+00',
  'updated_at wird tatsaechlich vom Trigger auf einen neuen Wert gesetzt'
);

select throws_ok($$
  update public.calendar_events set owner_id='22222222-2222-2222-2222-222222222222' where id='99000000-0000-0000-0000-000000000010'
$$,'42501',null,'Owner column is not grant-updatable');

select throws_ok($$
  update public.calendar_events set course_id='99000000-0000-0000-0000-000000000002' where id='99000000-0000-0000-0000-000000000010'
$$,'42501',null,'Cannot move an event to a foreign course');

select lives_ok($$
  update public.calendar_events set title='Vorlesung (verschoben)', starts_at='2026-10-13 09:00+00' where id='99000000-0000-0000-0000-000000000010'
$$,'Owner can edit their own event');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.calendar_events where owner_id='11111111-1111-1111-1111-111111111111'),0,'Other users cannot see the events');

update public.calendar_events set title='hacked' where id='99000000-0000-0000-0000-000000000010';
delete from public.calendar_events where id='99000000-0000-0000-0000-000000000011';

-- Verify the outcome with RLS bypassed: checking as the attacking user would
-- read 0 rows regardless, since their own SELECT policy already hides them.
reset role;

select is((select count(*)::int from public.calendar_events where id='99000000-0000-0000-0000-000000000010' and title='hacked'),0,'Foreign update affects no rows');
select is((select count(*)::int from public.calendar_events where id='99000000-0000-0000-0000-000000000011'),1,'Foreign delete affects no rows');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select title from public.calendar_events where id='99000000-0000-0000-0000-000000000010'),'Vorlesung (verschoben)','Edit by the real owner took effect, not the foreign attempt');

select lives_ok($$delete from public.calendar_events where id='99000000-0000-0000-0000-000000000011'$$,'Owner can delete their own event');

reset role;
delete from public.courses where id='99000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.calendar_events where id='99000000-0000-0000-0000-000000000010'),0,'Course cascade removes its events');

select * from finish();
rollback;
