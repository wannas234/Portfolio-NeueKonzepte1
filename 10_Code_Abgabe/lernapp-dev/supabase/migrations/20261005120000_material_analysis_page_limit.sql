begin;

-- Since visual extraction, source_documents.pages carries per-page metadata
-- (blocks, extraction, native_text). Measuring pages::text counted that
-- metadata (~3x the text) and rejected ordinary lectures as too large; it was
-- also sent to the model. Limit and return only page numbers and text.
create or replace function public.begin_material_analysis(p_owner_id uuid,p_request_id uuid,p_material_id uuid,p_context jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.material_analyses; source public.source_documents; fingerprint text; source_pages jsonb;
begin
  if p_owner_id is null or p_request_id is null or p_material_id is null or p_context is null
    or jsonb_typeof(p_context)<>'object' then raise exception 'INVALID_REQUEST'; end if;
  -- Serialize reservations per owner, including parallel HTTP retries.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,431));
  select d.* into source from public.source_documents d
    join public.materials m on m.id=d.material_id join public.courses c on c.id=m.course_id
    join public.files f on f.id=m.file_id
    where m.id=p_material_id and c.owner_id=p_owner_id and f.status='ready';
  if not found then raise exception 'TARGET_NOT_FOUND'; end if;
  if source.processing_status<>'ready' or nullif(btrim(source.extracted_text),'') is null then raise exception 'SOURCES_NOT_READY'; end if;
  if jsonb_typeof(source.pages)='array' then
    select jsonb_agg(jsonb_build_object('page',p->'page','text',p->'text') order by ord) into source_pages
      from jsonb_array_elements(source.pages) with ordinality x(p,ord);
  end if;
  if length(source.extracted_text)>60000 or length(coalesce(source_pages::text,''))>120000 then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  fingerprint := md5(jsonb_build_array(source.extracted_text,source.pages)::text);
  select * into a from public.material_analyses where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if a.material_id<>p_material_id or a.context<>p_context then raise exception 'REQUEST_CONFLICT'; end if;
    if a.source_hash<>fingerprint then raise exception 'SOURCE_CHANGED'; end if;
    return jsonb_build_object('run',false,'result',public.read_material_analysis(p_owner_id,a.id));
  end if;
  update public.material_analyses set status='failed',error_code='ANALYSIS_TIMEOUT'
    where owner_id=p_owner_id and status='processing' and lease_until<=now();
  if (select count(*) from public.material_analyses where owner_id=p_owner_id and created_at>now()-interval '1 minute')>=6
    or exists(select 1 from public.material_analyses where owner_id=p_owner_id and status='processing')
    then raise exception 'ANALYSIS_RATE_LIMITED'; end if;
  insert into public.material_analyses(owner_id,request_id,material_id,context,source_hash)
    values(p_owner_id,p_request_id,p_material_id,p_context,fingerprint) returning * into a;
  return jsonb_build_object('run',true,'analysis_id',a.id,'lease_token',a.lease_token,
    'source',jsonb_build_object('text',source.extracted_text,'pages',source_pages));
end;
$$;

revoke all on function public.begin_material_analysis(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_material_analysis(uuid,uuid,uuid,jsonb) to service_role;
commit;
