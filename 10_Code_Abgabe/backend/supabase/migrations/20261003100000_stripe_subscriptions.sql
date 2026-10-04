-- Stripe-Abonnements: Spiegel des Stripe-Zustands pro Nutzer plus
-- Idempotenz-Tabelle für Webhook-Events.
--
-- Geschrieben wird ausschließlich vom Backend (Edge Functions mit service_role,
-- das RLS umgeht). Angemeldete Nutzer dürfen nur ihre eigene Subscription lesen.
-- Ein Nutzer kann sich dadurch nie selbst als zahlend markieren.
begin;

-- ---------------------------------------------------------------------------
-- subscriptions: höchstens eine Zeile pro Nutzer
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Stripe-Abonnement eines Nutzers (1:1 zu auth.users). Nur über service_role schreibbar.';
comment on column public.subscriptions.status is
  'Stripe-Status unverändert übernommen (active, trialing, past_due, canceled, ...).';

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- stripe_events: verarbeitete Webhook-Events (Idempotenz)
-- ---------------------------------------------------------------------------

create table public.stripe_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Bereits verarbeitete Stripe-Webhook-Events. Keine Client-Policies, nur service_role.';

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public, anon, authenticated;
grant all on public.stripe_events to service_role;

commit;
