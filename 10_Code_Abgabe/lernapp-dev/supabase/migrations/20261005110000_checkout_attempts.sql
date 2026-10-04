-- One durable Stripe idempotency key and immutable payload per outstanding checkout.
begin;
create table public.checkout_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  stripe_session_id text,
  created_at timestamptz not null default now()
);
alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from public, anon, authenticated;
grant all on public.checkout_attempts to service_role;

-- Only the server may replace an attempt, after verifying an expired session
-- or a completed checkout whose subscription has ended at Stripe.
-- Compare-and-swap prevents two callers rotating the same attempt.
create function public.reserve_checkout_attempt(p_user_id uuid, p_parameters jsonb,
  p_expired_attempt uuid default null, p_open_session text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.checkout_attempts;
begin
  if p_user_id is null or p_parameters is null or jsonb_typeof(p_parameters) <> 'object' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 8303));
  select * into a from public.checkout_attempts where user_id = p_user_id for update;
  if not found then
    insert into public.checkout_attempts(user_id, parameters, stripe_session_id)
      values(p_user_id, p_parameters, p_open_session) returning * into a;
  elsif a.id = p_expired_attempt and a.stripe_session_id is not null then
    update public.checkout_attempts set id = gen_random_uuid(), parameters = p_parameters,
      stripe_session_id = p_open_session, created_at = now()
      where user_id = p_user_id returning * into a;
  end if;
  return to_jsonb(a);
end;
$$;
revoke all on function public.reserve_checkout_attempt(uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_checkout_attempt(uuid,jsonb,uuid,text) to service_role;
commit;
