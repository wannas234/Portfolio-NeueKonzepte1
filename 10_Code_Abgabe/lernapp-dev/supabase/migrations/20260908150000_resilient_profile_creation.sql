-- Optionale User-Metadaten dürfen eine Registrierung nicht verhindern.
-- Bestehende Profile und die Constraints für spätere Änderungen bleiben erhalten.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  if jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string' then
    profile_name := regexp_replace(
      new.raw_user_meta_data ->> 'display_name', '^[[:space:]]+|[[:space:]]+$', '', 'g'
    );
  end if;

  if profile_name is null or char_length(profile_name) not between 1 and 60 then
    profile_name := 'Lernende Person';
  end if;

  insert into public.profiles (id, display_name) values (new.id, profile_name);
  return new;
end;
$$;
