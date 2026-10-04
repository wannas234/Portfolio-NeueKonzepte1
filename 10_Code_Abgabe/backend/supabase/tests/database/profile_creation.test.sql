begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Keine E-Mail nötig: Auch künftige Phone-/OAuth-Nutzer bekommen ein Profil.
insert into auth.users (id, raw_user_meta_data)
values
  ('33333333-0000-0000-0000-000000000001', '{}'),
  ('33333333-0000-0000-0000-000000000002', '{"display_name":""}'),
  ('33333333-0000-0000-0000-000000000003', jsonb_build_object('display_name', E' \t\n ')),
  ('33333333-0000-0000-0000-000000000004', jsonb_build_object('display_name', repeat('x', 61))),
  ('33333333-0000-0000-0000-000000000005', '{"display_name":null}'),
  ('33333333-0000-0000-0000-000000000006', '{"display_name":{"untrusted":true}}'),
  ('33333333-0000-0000-0000-000000000007', '{"display_name":"  Anna  "}'),
  ('33333333-0000-0000-0000-000000000008', jsonb_build_object('display_name', repeat('ä', 60)));

select is(name, 'Lernende Person', 'Ungültige Metadaten: ' || id::text)
from public.profiles
where id between '33333333-0000-0000-0000-000000000001'::uuid
             and '33333333-0000-0000-0000-000000000006'::uuid
order by id;

select is(
  (select name from public.profiles where id = '33333333-0000-0000-0000-000000000007'),
  'Anna', 'Gültiger Name wird getrimmt'
);
select is(
  (select name from public.profiles where id = '33333333-0000-0000-0000-000000000008'),
  repeat('ä', 60), '60 Unicode-Zeichen sind zulässig'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set name = '' where id = '33333333-0000-0000-0000-000000000007'$$,
  '23514', null, 'Leere spätere Profiländerung wird abgewiesen'
);
select throws_ok(
  $$update public.profiles set name = repeat('x', 61) where id = '33333333-0000-0000-0000-000000000007'$$,
  '23514', null, 'Überlange spätere Profiländerung wird abgewiesen'
);
reset role;
select * from finish();
rollback;
