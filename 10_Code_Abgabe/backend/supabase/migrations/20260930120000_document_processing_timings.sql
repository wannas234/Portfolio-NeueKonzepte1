begin;

-- Retained after queue jobs finish; one row per claim, including retries/batches.
create table public.document_processing_runs (
  id uuid primary key,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  worker text not null check (worker in ('extraction', 'indexing')),
  batch_start integer check (batch_start >= 0),
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms double precision check (duration_ms >= 0 and duration_ms < 'Infinity'::double precision),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'discarded')),
  phases jsonb not null default '[]'::jsonb check (jsonb_typeof(phases) = 'array'),
  check ((status = 'running') = (completed_at is null)),
  check ((status = 'running') = (duration_ms is null)),
  check ((worker = 'indexing') = (batch_start is not null))
);
create index document_processing_runs_document_started on public.document_processing_runs(document_id, started_at);
alter table public.document_processing_runs enable row level security;
revoke all on public.document_processing_runs from public, anon, authenticated;
grant select on public.document_processing_runs to authenticated;
grant all on public.document_processing_runs to service_role;
create policy document_processing_runs_select_owned on public.document_processing_runs
  for select to authenticated using (
    exists (select 1 from public.source_documents d where d.id = document_id)
  );
comment on table public.document_processing_runs is
  'Worker timings since instrumentation deployment. Running rows may be interrupted workers. Phases exclude queue waits; indexing has one run per batch.';

commit;
