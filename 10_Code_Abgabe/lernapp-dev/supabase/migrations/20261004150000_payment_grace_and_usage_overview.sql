-- Schonfrist bei Zahlungsfehlern und Verbrauchsübersicht für das Frontend.
--
-- Regeln für den Tarif (current_plan):
-- - active, trialing: pro. Eine Kündigung zum Periodenende ändert daran nichts, Stripe meldet
--   erst zum Ende canceled.
-- - past_due: pro, solange die Schonfrist läuft (7 Tage ab dem ersten Zahlungsfehler). Danach
--   free. Stripe versucht in dieser Zeit weiter abzubuchen; die Smart-Retries im Stripe-Dashboard
--   sollen ungefähr gleich lang laufen und danach das Abo kündigen.
-- - alles andere (unpaid, paused, incomplete, canceled, ...): free.
-- Bei free bleiben alle Daten erhalten. Wer über dem Gratis-Speicher liegt, behält seine Dateien,
-- kann aber nichts Neues hochladen (enforce_upload_quota). Der Monatsverbrauch zählt tarifunabhängig
-- weiter.
--
-- Die Frist steht nur hier (subscription_grace_until). Das Frontend liest grace_until als
-- berechnete Spalte der eigenen Abo-Zeile und get_my_usage für die Verbrauchsanzeige.
begin;

alter table public.subscriptions add column past_due_since timestamptz;
comment on column public.subscriptions.past_due_since is
  'Beginn des aktuellen past_due-Zeitraums. Setzt allein der Trigger subscriptions_track_past_due.';

-- Die Uhr startet beim Wechsel nach past_due und läuft bei weiteren past_due-Events weiter.
-- In der DB statt im Webhook, damit Reihenfolge und Wiederholung von Events egal sind.
create function public.track_past_due() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'past_due' then
    new.past_due_since := case
      when tg_op = 'UPDATE' and old.status = 'past_due' then coalesce(old.past_due_since, now())
      else now() end;
  else
    new.past_due_since := null;
  end if;
  return new;
end;
$$;
create trigger subscriptions_track_past_due before insert or update on public.subscriptions
  for each row execute function public.track_past_due();

-- Bestehende past_due-Zeilen: letzte Änderung als Beginn, die Frist läuft also ab dort.
update public.subscriptions set past_due_since = updated_at where status = 'past_due';

-- Ende der Schonfrist, null außerhalb von past_due. Als berechnete Spalte über PostgREST
-- lesbar: select=status,grace_until (RLS der Tabelle gilt weiter).
create function public.grace_until(s public.subscriptions) returns timestamptz
language sql stable set search_path = '' as $$
  select case when s.status = 'past_due' then s.past_due_since + interval '7 days' end;
$$;

create or replace function public.current_plan(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.subscriptions s where s.user_id = p_user_id
    and (s.status in ('active', 'trialing') or public.grace_until(s) > now()))
    then 'pro' else 'free' end;
$$;

create function public.usage_period_end() returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('month', now() at time zone 'Europe/Berlin') + interval '1 month')
    at time zone 'Europe/Berlin';
$$;

-- Verbrauch des aufrufenden Nutzers im laufenden Monat. Keine Nutzer-ID als Parameter: wer
-- fragt, bestimmt allein der JWT. pro_limit erlaubt den Upgrade-Hinweis mit echten Zahlen.
create function public.get_my_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_usage jsonb;
  v_storage bigint;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_plan := public.current_plan(v_user);
  select coalesce(jsonb_object_agg(l.kind, jsonb_build_object('used', coalesce(u.used, 0),
      'limit', l.value, 'pro_limit', p.value)), '{}') into v_usage
    from public.plan_limits l
    join public.plan_limits p on p.plan = 'pro' and p.kind = l.kind
    left join (select kind, count(*) used from public.usage_events
      where user_id = v_user and created_at >= public.usage_period_start() group by kind) u
      on u.kind = l.kind
    where l.plan = v_plan and l.kind not in ('search_per_minute', 'storage_bytes');
  -- Wie enforce_upload_quota: offene Uploads zählen mit.
  select coalesce(sum(size_bytes), 0) into v_storage from public.files
    where uploaded_by = v_user and status in ('unverified', 'pending', 'ready');
  return jsonb_build_object(
    'plan', v_plan,
    'grace_until', (select public.grace_until(s) from public.subscriptions s where s.user_id = v_user),
    'resets_at', public.usage_period_end(),
    'usage', v_usage,
    'storage', jsonb_build_object('used_bytes', v_storage,
      'limit_bytes', (select value from public.plan_limits where plan = v_plan and kind = 'storage_bytes'),
      'pro_limit_bytes', (select value from public.plan_limits where plan = 'pro' and kind = 'storage_bytes')));
end;
$$;

revoke all on function public.track_past_due(), public.usage_period_end(), public.get_my_usage()
  from public, anon, authenticated;
revoke all on function public.grace_until(public.subscriptions) from public, anon;
grant execute on function public.grace_until(public.subscriptions) to authenticated, service_role;
grant execute on function public.usage_period_end() to service_role;
grant execute on function public.get_my_usage() to authenticated, service_role;

commit;
