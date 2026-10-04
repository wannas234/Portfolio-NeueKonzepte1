begin;

-- Append-only timeline of the document pipeline (upload -> extraction -> OCR ->
-- indexing). Written exclusively by triggers, so the claim/finish RPCs and the
-- Edge Functions stay unchanged. clock_timestamp() keeps events inside one
-- transaction ordered and distinct. Operator-only: no client access.
create table public.document_pipeline_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  event text not null check (event in (
    'upload_completed',
    'processing_queued', 'processing_claimed', 'processing_ready', 'processing_failed', 'processing_reset',
    'ocr_checkpoint',
    'indexing_queued', 'indexing_claimed', 'indexing_batch', 'indexing_ready', 'indexing_failed', 'indexing_reset'
  )),
  occurred_at timestamptz not null default clock_timestamp(),
  detail jsonb not null default '{}'::jsonb
);
create index document_pipeline_events_timeline on public.document_pipeline_events(document_id, occurred_at);
alter table public.document_pipeline_events enable row level security;
revoke all on public.document_pipeline_events from public, anon, authenticated;
grant all on public.document_pipeline_events to service_role;

create function public.log_document_pipeline_event(p_document_id uuid, p_event text,
  p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.document_pipeline_events(document_id, event, detail)
    values (p_document_id, p_event, coalesce(p_detail, '{}'::jsonb));
$$;

create function public.log_source_document_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f public.files;
begin
  select f0.* into f from public.materials m join public.files f0 on f0.id = m.file_id
    where m.id = new.material_id;
  perform public.log_document_pipeline_event(new.id, 'upload_completed', jsonb_build_object(
    'file_id', f.id, 'upload_started_at', f.created_at, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes));
  return new;
end;
$$;
create trigger source_documents_log_created after insert on public.source_documents
  for each row execute function public.log_source_document_created();

-- Every claim re-sets 'processing', so each claim (retry, OCR poll) is logged.
create function public.log_document_processing_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.processing_status = 'processing' then
    perform public.log_document_pipeline_event(new.id, 'processing_claimed', jsonb_build_object(
      'attempt', (select attempts from public.document_processing_jobs where document_id = new.id)));
  elsif new.processing_status is distinct from old.processing_status then
    perform public.log_document_pipeline_event(new.id, case new.processing_status
        when 'ready' then 'processing_ready' when 'failed' then 'processing_failed' else 'processing_reset' end,
      case new.processing_status
        when 'ready' then jsonb_build_object('page_count', new.page_count,
          'text_chars', length(new.extracted_text))
        when 'failed' then jsonb_build_object('error_code', new.error_code)
        else '{}'::jsonb end);
  end if;
  return new;
end;
$$;
create trigger source_documents_log_processing after update of processing_status on public.source_documents
  for each row execute function public.log_document_processing_status();

create function public.log_document_indexing_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.indexing_status = 'processing' then
    perform public.log_document_pipeline_event(new.id, 'indexing_claimed', jsonb_build_object(
      'attempt', (select attempts from public.document_indexing_jobs where document_id = new.id)));
  elsif new.indexing_status is distinct from old.indexing_status then
    perform public.log_document_pipeline_event(new.id, case new.indexing_status
        when 'ready' then 'indexing_ready' when 'failed' then 'indexing_failed' else 'indexing_reset' end,
      case new.indexing_status
        when 'ready' then jsonb_build_object('chunk_count',
          (select count(*) from public.document_chunks where document_id = new.id))
        when 'failed' then jsonb_build_object('error_code', new.indexing_error)
        else '{}'::jsonb end);
  end if;
  return new;
end;
$$;
create trigger source_documents_log_indexing after update of indexing_status on public.source_documents
  for each row execute function public.log_document_indexing_status();

create function public.log_document_processing_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_pipeline_event(new.document_id, 'processing_queued',
      jsonb_build_object('available_at', new.available_at));
  elsif new.checkpoint is not null then
    -- One checkpoint after the local analysis, then one per Gemini page.
    perform public.log_document_pipeline_event(new.document_id, 'ocr_checkpoint', (
      select jsonb_build_object('pages', count(*),
        'visual_pages', count(*) filter (where p->>'route' = 'visual'),
        'visual_done', count(*) filter (where p->>'route' = 'visual'
          and coalesce(jsonb_typeof(p->'extraction'), 'null') <> 'null'))
      from jsonb_array_elements(new.checkpoint->'pages') p));
  end if;
  return new;
end;
$$;
create trigger document_processing_jobs_log_queued after insert on public.document_processing_jobs
  for each row execute function public.log_document_processing_job();
create trigger document_processing_jobs_log_ocr after update of checkpoint on public.document_processing_jobs
  for each row execute function public.log_document_processing_job();

create function public.log_document_indexing_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_pipeline_event(new.document_id, 'indexing_queued',
      jsonb_build_object('available_at', new.available_at));
  elsif new.next_index > old.next_index then
    perform public.log_document_pipeline_event(new.document_id, 'indexing_batch', jsonb_build_object(
      'stored', new.next_index - old.next_index, 'next_index', new.next_index, 'total_chunks', new.total_chunks));
  end if;
  return new;
end;
$$;
create trigger document_indexing_jobs_log_queued after insert on public.document_indexing_jobs
  for each row execute function public.log_document_indexing_job();
create trigger document_indexing_jobs_log_batch after update of next_index on public.document_indexing_jobs
  for each row execute function public.log_document_indexing_job();

revoke all on function public.log_document_pipeline_event(uuid,text,jsonb),
  public.log_source_document_created(), public.log_document_processing_status(),
  public.log_document_indexing_status(), public.log_document_processing_job(),
  public.log_document_indexing_job() from public, anon, authenticated;

-- Durations of the latest run per document. A run starts at the latest
-- queue/reset event, so retries do not blend into earlier attempts. Documents
-- processed before this migration fall back to started_at/completed_at and the
-- last chunk's created_at.
create view public.document_pipeline_timings with (security_invoker = true) as
with runs as (
  select d.id,
    (select max(occurred_at) from public.document_pipeline_events e where e.document_id = d.id
      and e.event in ('processing_queued', 'processing_reset')) as processing_queued_at,
    (select max(occurred_at) from public.document_pipeline_events e where e.document_id = d.id
      and e.event in ('indexing_queued', 'indexing_reset')) as indexing_queued_at
  from public.source_documents d
), stages as (
  select r.*,
    coalesce((select min(occurred_at) from public.document_pipeline_events e where e.document_id = r.id
      and e.event = 'processing_claimed' and e.occurred_at >= r.processing_queued_at), d.started_at) as processing_started_at,
    (select min(occurred_at) from public.document_pipeline_events e where e.document_id = r.id
      and e.event = 'ocr_checkpoint' and e.occurred_at >= r.processing_queued_at) as ocr_started_at,
    coalesce((select max(occurred_at) from public.document_pipeline_events e where e.document_id = r.id
      and e.event in ('processing_ready', 'processing_failed') and e.occurred_at >= r.processing_queued_at), d.completed_at) as processing_completed_at,
    (select count(*) from public.document_pipeline_events e where e.document_id = r.id
      and e.event = 'processing_claimed' and e.occurred_at >= r.processing_queued_at) as processing_claims,
    (select min(occurred_at) from public.document_pipeline_events e where e.document_id = r.id
      and e.event = 'indexing_claimed' and e.occurred_at >= r.indexing_queued_at) as indexing_started_at,
    case when r.indexing_queued_at is null and d.indexing_status = 'ready' then
      -- Legacy: the final batch and 'ready' commit in one transaction.
      (select max(created_at) from public.document_chunks c where c.document_id = r.id)
    else (select max(occurred_at) from public.document_pipeline_events e where e.document_id = r.id
      and e.event in ('indexing_ready', 'indexing_failed') and e.occurred_at >= r.indexing_queued_at)
    end as indexing_completed_at,
    (select count(*) from public.document_pipeline_events e where e.document_id = r.id
      and e.event = 'indexing_claimed' and e.occurred_at >= r.indexing_queued_at) as indexing_claims
  from runs r join public.source_documents d on d.id = r.id
)
select d.id as document_id, coalesce(f.original_filename, m.title) as original_filename, f.mime_type, f.size_bytes, d.page_count,
  length(d.extracted_text) as text_chars,
  (select count(*) from public.document_chunks c where c.document_id = d.id) as chunk_count,
  d.processing_status, d.error_code, d.indexing_status, d.indexing_error,
  f.created_at as upload_started_at, d.created_at as upload_completed_at,
  s.processing_queued_at, s.processing_started_at, s.ocr_started_at, s.processing_completed_at,
  s.indexing_queued_at, s.indexing_started_at, s.indexing_completed_at,
  d.created_at - f.created_at as upload_duration,
  s.processing_started_at - s.processing_queued_at as processing_wait,
  s.processing_completed_at - s.processing_started_at as extraction_duration,
  s.processing_completed_at - s.ocr_started_at as ocr_duration,
  s.indexing_started_at - s.indexing_queued_at as indexing_wait,
  s.indexing_completed_at - s.indexing_started_at as indexing_duration,
  s.indexing_completed_at - f.created_at as total_duration,
  s.processing_claims, s.indexing_claims
from stages s
join public.source_documents d on d.id = s.id
join public.materials m on m.id = d.material_id
left join public.files f on f.id = m.file_id;
revoke all on public.document_pipeline_timings from public, anon, authenticated;
grant select on public.document_pipeline_timings to service_role;

commit;
