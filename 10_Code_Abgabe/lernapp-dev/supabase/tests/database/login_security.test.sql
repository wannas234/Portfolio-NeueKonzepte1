begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.profiles
  where id = '22222222-2222-2222-2222-222222222222'), 0, 'Fremdes Profil ist unsichtbar');
select throws_ok($$insert into public.profiles (id, name)
  values ('33333333-3333-3333-3333-333333333333', 'Fremd')$$,
  '42501', 'permission denied for table profiles', 'Client kann keine Profile anlegen');
select throws_ok($$delete from public.profiles$$,
  '42501', 'permission denied for table profiles', 'Client kann keine Profile löschen');
select throws_ok($$update public.profiles set id = '33333333-3333-3333-3333-333333333333'$$,
  '42501', 'permission denied for table profiles', 'Identität ist unveränderlich');
select throws_ok($$update public.profiles set created_at = now()$$,
  '42501', 'permission denied for table profiles', 'Erstellungszeit ist unveränderlich');
select throws_ok($$update public.profiles set updated_at = now()$$,
  '42501', 'permission denied for table profiles', 'Änderungszeit wird nur vom Trigger gesetzt');
select throws_ok($$truncate public.profiles$$,
  '42501', 'permission denied for table profiles', 'TRUNCATE ist verboten');
select throws_ok($$update public.profiles set name = ''$$,
  '23514', null, 'Leerer Anzeigename wird abgewiesen');

set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*)::int from public.profiles), 0, 'Ohne sub keine Profile');
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.profiles
  where id = '11111111-1111-1111-1111-111111111111'), 0, 'Auth-Löschung entfernt das Profil');
select * from finish();
rollback;
