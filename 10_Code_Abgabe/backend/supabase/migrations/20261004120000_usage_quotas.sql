-- Nutzungskontingente pro Tarif (free/pro) und dauerhaftes Verbrauchskonto.
--
-- plan_limits: aktuelle Grenzwerte. Quelle der Wahrheit ist supabase/usage-limits.mjs.
--   Deploy (configure-file-cleanup.mjs) und lokaler Start (configure-local-workers.mjs)
--   spielen die Datei über configure_plan_limits ein. Die Werte unten gelten nur bis zum
--   ersten Einspielen.
-- usage_events: eine Zeile pro kostenpflichtiger Aktion. Hängt nur am Profil, nicht an
--   Unterhaltungen, Jobs oder Dateien, und bleibt deshalb erhalten, wenn Nutzer Chats,
--   Ergebnisse oder Dateien löschen (z. B. die temporären Chats der Dokument-KI-Aktionen).
--
-- Durchsetzung:
-- - Neue Zusammenfassungs-, Karteikarten- und Analyse-Jobs sowie neue Dateien zählen per
--   BEFORE-INSERT-Trigger. Replays und deduplizierte Anfragen legen keine Zeile an und
--   kosten daher nichts. Der Trigger greift auf jedem Weg, auch beim direkten RPC-Aufruf.
-- - Chat und direkte Suche buchen in der Edge Function über consume_usage, unmittelbar vor
--   dem ersten kostenpflichtigen Provider-Aufruf. Der Schlüssel (request_id) macht
--   Wiederholungen idempotent.
begin;

create table public.plan_limits (
  plan text not null check (plan in ('free', 'pro')),
  kind text not null check (kind in ('chat', 'search', 'search_per_minute', 'summary',
    'flashcards', 'material_analysis', 'upload', 'storage_bytes')),
  value bigint not null check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (plan, kind)
);
comment on table public.plan_limits is
  'Kontingente pro Tarif. Wird aus supabase/usage-limits.mjs eingespielt, nicht von Hand pflegen.';
alter table public.plan_limits enable row level security;
revoke all on public.plan_limits from public, anon, authenticated;
grant select on public.plan_limits to authenticated;
grant all on public.plan_limits to service_role;
create policy plan_limits_select on public.plan_limits for select to authenticated using (true);

insert into public.plan_limits(plan, kind, value) values
  ('free', 'chat', 100), ('free', 'search', 200), ('free', 'search_per_minute', 10),
  ('free', 'summary', 10), ('free', 'flashcards', 5), ('free', 'material_analysis', 10),
  ('free', 'upload', 20), ('free', 'storage_bytes', 262144000),
  ('pro', 'chat', 1500), ('pro', 'search', 3000), ('pro', 'search_per_minute', 30),
  ('pro', 'summary', 100), ('pro', 'flashcards', 50), ('pro', 'material_analysis', 100),
  ('pro', 'upload', 300), ('pro', 'storage_bytes', 5242880000);

create table public.usage_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('chat', 'search', 'summary', 'flashcards',
    'material_analysis', 'upload')),
  key text not null check (char_length(key) between 1 and 100),
  plan text not null check (plan in ('free', 'pro')),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);
comment on table public.usage_events is
  'Verbrauchskonto: eine Zeile pro kostenpflichtiger Aktion. Nur über service_role/Trigger schreibbar.';
create index usage_events_window on public.usage_events(user_id, kind, created_at);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from public, anon, authenticated;
grant select on public.usage_events to authenticated;
grant all on public.usage_events to service_role;
create policy usage_events_select_own on public.usage_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- Pro-Zugriff nur in denselben Status wie im Frontend (lib/billing.ts).
create function public.current_plan(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.subscriptions s where s.user_id = p_user_id
    and s.status in ('active', 'trialing')) then 'pro' else 'free' end;
$$;

create function public.usage_period_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
$$;

create function public.consume_usage(p_user_id uuid, p_kind text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_limit bigint;
  v_rate bigint;
  v_used bigint;
  v_recent timestamptz[];
  v_start timestamptz := public.usage_period_start();
begin
  if p_user_id is null or p_key is null or char_length(p_key) not between 1 and 100
    or p_kind is null or p_kind not in ('chat', 'search', 'summary', 'flashcards',
      'material_analysis', 'upload') then
    raise exception 'INVALID_USAGE' using errcode = '22023';
  end if;
  -- Serialisiert gleichzeitige Aktionen derselben Art: Zählen und Eintragen sind atomar.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind, 8301));
  if exists (select 1 from public.usage_events
    where user_id = p_user_id and kind = p_kind and key = p_key) then
    return jsonb_build_object('allowed', true, 'replay', true);
  end if;
  v_plan := public.current_plan(p_user_id);
  select value into v_limit from public.plan_limits where plan = v_plan and kind = p_kind;
  if v_limit is null then
    raise exception 'USAGE_LIMIT_NOT_CONFIGURED' using errcode = '55000';
  end if;
  select count(*) into v_used from public.usage_events
    where user_id = p_user_id and kind = p_kind and created_at >= v_start;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'code', 'QUOTA_EXCEEDED', 'plan', v_plan,
      'limit', v_limit, 'used', v_used,
      'resets_at', (date_trunc('month', now() at time zone 'Europe/Berlin') + interval '1 month')
        at time zone 'Europe/Berlin');
  end if;
  if p_kind = 'search' then
    select value into v_rate from public.plan_limits
      where plan = v_plan and kind = 'search_per_minute';
    if v_rate is null then
      raise exception 'USAGE_LIMIT_NOT_CONFIGURED' using errcode = '55000';
    end if;
    select coalesce(array_agg(created_at order by created_at), '{}') into v_recent
      from public.usage_events
      where user_id = p_user_id and kind = 'search' and created_at > now() - interval '1 minute';
    if cardinality(v_recent) >= v_rate then
      return jsonb_build_object('allowed', false, 'code', 'RATE_LIMITED', 'plan', v_plan,
        'retry_after_seconds', greatest(1, coalesce(ceil(extract(epoch from
          (v_recent[1] + interval '1 minute' - now())))::integer, 60)));
    end if;
  end if;
  insert into public.usage_events(user_id, kind, key, plan) values (p_user_id, p_kind, p_key, v_plan);
  return jsonb_build_object('allowed', true, 'plan', v_plan, 'limit', v_limit, 'used', v_used + 1);
end;
$$;

-- Tokens nachtragen, sobald der Provider sie gemeldet hat (nur Auswertung, keine Grenze).
create function public.record_usage_tokens(p_user_id uuid, p_kind text, p_key text,
  p_input_tokens integer, p_output_tokens integer) returns void
language sql security definer set search_path = '' as $$
  update public.usage_events set input_tokens = p_input_tokens, output_tokens = p_output_tokens
    where user_id = p_user_id and kind = p_kind and key = p_key;
$$;

-- Trigger-Argumente: Art des Verbrauchs, Name der Besitzer-Spalte.
create function public.enforce_usage_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := public.consume_usage((to_jsonb(new) ->> tg_argv[1])::uuid, tg_argv[0], new.id::text);
  if not (v_result ->> 'allowed')::boolean then
    raise exception '%', v_result ->> 'code' using detail = v_result::text;
  end if;
  return new;
end;
$$;

create function public.enforce_upload_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_limit bigint; v_used bigint;
begin
  -- consume_usage hält die Upload-Sperre des Nutzers bis Transaktionsende, damit
  -- gleichzeitige Uploads auch beim Speicherplatz nicht beide die alte Summe sehen.
  v_result := public.consume_usage(new.uploaded_by, 'upload', new.id::text);
  if not (v_result ->> 'allowed')::boolean then
    raise exception '%', v_result ->> 'code' using detail = v_result::text;
  end if;
  select value into v_limit from public.plan_limits
    where plan = public.current_plan(new.uploaded_by) and kind = 'storage_bytes';
  if v_limit is null then
    raise exception 'USAGE_LIMIT_NOT_CONFIGURED' using errcode = '55000';
  end if;
  -- Offene Uploads zählen mit, sonst ließen sich viele parallel vorbereiten.
  select coalesce(sum(size_bytes), 0) into v_used from public.files
    where uploaded_by = new.uploaded_by and status in ('unverified', 'pending', 'ready');
  if v_used + new.size_bytes > v_limit then
    raise exception 'STORAGE_QUOTA_EXCEEDED' using detail =
      jsonb_build_object('limit_bytes', v_limit, 'used_bytes', v_used)::text;
  end if;
  return new;
end;
$$;

create trigger summary_jobs_usage_quota before insert on public.summary_jobs
  for each row execute function public.enforce_usage_quota('summary', 'owner_id');
create trigger flashcard_jobs_usage_quota before insert on public.flashcard_jobs
  for each row execute function public.enforce_usage_quota('flashcards', 'owner_id');
create trigger material_analyses_usage_quota before insert on public.material_analyses
  for each row execute function public.enforce_usage_quota('material_analysis', 'owner_id');
-- Name sortiert nach files_prevent_reuse: gelöschte Upload-Keys scheitern vorher ohne Buchung.
create trigger files_usage_quota before insert on public.files
  for each row execute function public.enforce_upload_quota();

create function public.configure_plan_limits(p_limits jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_kind text;
  v_value jsonb;
  v_kinds text[] := array['chat', 'search', 'search_per_minute', 'summary', 'flashcards',
    'material_analysis', 'upload', 'storage_bytes'];
begin
  if jsonb_typeof(p_limits) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_limits) k)
      is distinct from array['free', 'pro'] then
    raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
  end if;
  foreach v_plan in array array['free', 'pro'] loop
    if jsonb_typeof(p_limits -> v_plan) is distinct from 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(p_limits -> v_plan) k)
        is distinct from (select array_agg(k order by k) from unnest(v_kinds) k) then
      raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
    end if;
    foreach v_kind in array v_kinds loop
      v_value := p_limits -> v_plan -> v_kind;
      if jsonb_typeof(v_value) is distinct from 'number'
        or (v_value #>> '{}')::numeric < 0
        or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
        or (v_value #>> '{}')::numeric > 9007199254740991 then
        raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
      end if;
      insert into public.plan_limits(plan, kind, value)
        values (v_plan, v_kind, (v_value #>> '{}')::bigint)
        on conflict (plan, kind) do update set value = excluded.value, updated_at = now()
          where public.plan_limits.value is distinct from excluded.value;
    end loop;
  end loop;
end;
$$;

revoke all on function public.current_plan(uuid), public.usage_period_start(),
  public.consume_usage(uuid, text, text),
  public.record_usage_tokens(uuid, text, text, integer, integer),
  public.enforce_usage_quota(), public.enforce_upload_quota(),
  public.configure_plan_limits(jsonb) from public, anon, authenticated;
grant execute on function public.current_plan(uuid), public.usage_period_start(),
  public.consume_usage(uuid, text, text),
  public.record_usage_tokens(uuid, text, text, integer, integer),
  public.configure_plan_limits(jsonb) to service_role;

commit;
