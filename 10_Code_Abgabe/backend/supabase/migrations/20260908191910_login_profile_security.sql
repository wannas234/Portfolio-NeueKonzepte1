-- Auth verwaltet Identität und Lebenszyklus; Clients ändern nur den Anzeigenamen.
drop policy "Profile sind für angemeldete Nutzer lesbar" on public.profiles;
drop policy "Nutzer können ihr eigenes Profil anlegen" on public.profiles;
drop policy "Nutzer können ihr eigenes Profil löschen" on public.profiles;

create policy "Nutzer können ihr eigenes Profil lesen"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

comment on table public.profiles is
  'Privates Profil eines Auth-Nutzers. Erstellung durch Auth-Trigger, Löschung durch Auth-Cascade.';

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
