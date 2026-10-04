begin;
-- Private resumable page state. Published source_documents remain atomic.
-- File/material/account deletion follows the existing queue FK cascades.
alter table public.document_processing_jobs add column checkpoint jsonb;
create or replace function public.claim_document_processing(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents; j public.document_processing_jobs;
begin
  select f0.* into f from public.files f0 join public.document_processing_jobs j0 on j0.file_id = f0.id
    where j0.document_id = p_document_id and f0.status = 'ready' for update of f0 skip locked;
  if not found then return null; end if;
  select m0.* into m from public.materials m0 join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and m0.file_id = f.id and m0.course_id = f.course_id
      and m0.created_by = f.uploaded_by for update of m0;
  if not found or not exists (select 1 from public.courses where id = m.course_id and owner_id = m.created_by) then return null; end if;
  select * into d from public.source_documents where id = p_document_id for update;
  select * into j from public.document_processing_jobs where document_id = d.id for update;
  if not found or d.processing_status not in ('uploaded', 'processing')
    or j.available_at > now() or j.lease_until > now() then return null; end if;
  if j.attempts >= 3 then
    update public.source_documents set processing_status = 'failed', error_code = 'PROCESSING_TIMEOUT', completed_at = now() where id = d.id;
    delete from public.document_processing_jobs where document_id = d.id;
    return null;
  end if;
  update public.document_processing_jobs set attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
    where document_id = d.id returning * into j;
  update public.source_documents set processing_status = 'processing', started_at = now() where id = d.id;
  return jsonb_build_object('document_id', d.id, 'lease_token', j.lease_token,
    'lease_until', j.lease_until, 'attempt', j.attempts, 'checkpoint', j.checkpoint, 'file', to_jsonb(f));
end;
$$;

create function public.save_document_processing_checkpoint(p_document_id uuid, p_lease_token uuid,
  p_checkpoint jsonb, p_release boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents; j public.document_processing_jobs;
begin
  select f0.* into f from public.files f0 join public.document_processing_jobs j0 on j0.file_id = f0.id
    where j0.document_id = p_document_id and f0.status = 'ready' for update of f0;
  if not found then return false; end if;
  select m0.* into m from public.materials m0 join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and m0.file_id = f.id and m0.course_id = f.course_id
      and m0.created_by = f.uploaded_by for update of m0;
  if not found or not exists (select 1 from public.courses where id = m.course_id and owner_id = m.created_by) then return false; end if;
  select * into d from public.source_documents where id = p_document_id for update;
  select * into j from public.document_processing_jobs where document_id = d.id for update;
  if not found or d.processing_status <> 'processing' or p_lease_token is null
    or j.lease_token is distinct from p_lease_token or j.lease_until <= now() then return false; end if;
  if p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
    or p_checkpoint->>'version' is distinct from 'visual-blocks-v1'
    or jsonb_typeof(p_checkpoint->'model') is distinct from 'string'
    or jsonb_typeof(p_checkpoint->'pages') is distinct from 'array'
    or octet_length(p_checkpoint::text) > 20971520 then
    raise exception 'INVALID_PROCESSING_CHECKPOINT' using errcode = '22023';
  end if;
  if jsonb_array_length(p_checkpoint->'pages') not between 1 and 100 or exists (
    select 1 from jsonb_array_elements(p_checkpoint->'pages') with ordinality p(value,n)
    where value->'page' is distinct from to_jsonb(n)
      or jsonb_typeof(value->'text') is distinct from 'string'
      or coalesce(value->>'route','') not in ('local','visual')
  ) then raise exception 'INVALID_PROCESSING_CHECKPOINT' using errcode = '22023'; end if;
  update public.document_processing_jobs set checkpoint = p_checkpoint,
    attempts = case when p_release then 0 else attempts end,
    available_at = now(),
    lease_token = case when p_release then null else lease_token end,
    lease_until = case when p_release then null else lease_until end
    where document_id = d.id;
  return true;
end;
$$;
revoke all on function public.save_document_processing_checkpoint(uuid,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_document_processing_checkpoint(uuid,uuid,jsonb,boolean) to service_role;
commit;
