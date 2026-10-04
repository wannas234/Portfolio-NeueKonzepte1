begin;
-- A global sequence prevents revision reuse after deleting and recreating a draft.
create sequence public.learning_draft_revision_seq;
revoke all on sequence public.learning_draft_revision_seq from public,anon,authenticated;
create table public.learning_drafts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_material_id uuid not null references public.materials(id) on delete cascade,
  kind text not null check(kind in ('summary','flashcards')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=100000),
  revision bigint not null default nextval('public.learning_draft_revision_seq'),
  updated_at timestamptz not null default now(),
  primary key(user_id,source_material_id,kind)
);
create index learning_drafts_source_idx on public.learning_drafts(source_material_id);
alter table public.learning_drafts enable row level security;
revoke all on public.learning_drafts from public,anon,authenticated;
grant select on public.learning_drafts to authenticated;
create policy learning_drafts_owned on public.learning_drafts for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.materials m where m.id=source_material_id and m.type='source_document'));

-- NULL payload deletes the exact revision; clients call this only after a successful final save.
create function public.save_learning_draft(p_source_material uuid,p_kind text,p_payload jsonb,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare current_revision bigint; next_revision bigint; card jsonb;
begin
  if not exists(select 1 from public.materials m join public.courses c on c.id=m.course_id
    where m.id=p_source_material and m.type='source_document' and c.owner_id=auth.uid()) then
    raise exception 'SOURCE_NOT_FOUND' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('summary','flashcards') or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
  if p_payload is not null then
    if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000 then
      raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
    if p_kind='summary' then
      if jsonb_typeof(p_payload->'text') is distinct from 'string' or length(p_payload->>'text')>30000 then
        raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
    else
      if jsonb_typeof(p_payload->'cards') is distinct from 'array' then
        raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
      if jsonb_array_length(p_payload->'cards')>300 then raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
      for card in select value from jsonb_array_elements(p_payload->'cards') loop
        if jsonb_typeof(card) is distinct from 'object' or jsonb_typeof(card->'question') is distinct from 'string'
          or jsonb_typeof(card->'answer') is distinct from 'string' or length(card->>'question')>1000 or length(card->>'answer')>4000 then
          raise exception 'INVALID_DRAFT' using errcode='22023'; end if;
      end loop;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_source_material::text || p_kind,8105));
  select revision into current_revision from public.learning_drafts
    where user_id=auth.uid() and source_material_id=p_source_material and kind=p_kind;
  if coalesce(current_revision,0)<>p_expected_revision then raise exception 'DRAFT_CONFLICT' using errcode='40001'; end if;
  if p_payload is null then
    delete from public.learning_drafts where user_id=auth.uid() and source_material_id=p_source_material and kind=p_kind;
    return 0;
  end if;
  insert into public.learning_drafts(user_id,source_material_id,kind,payload)
    values(auth.uid(),p_source_material,p_kind,p_payload)
    on conflict(user_id,source_material_id,kind) do update set payload=excluded.payload,
      revision=excluded.revision,updated_at=now() returning revision into next_revision;
  return next_revision;
end $$;
revoke all on function public.save_learning_draft(uuid,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_learning_draft(uuid,text,jsonb,bigint) to authenticated;
commit;
