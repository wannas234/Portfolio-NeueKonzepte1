begin;

-- Private request receipts retain the original payload even after a deck is renamed.
create table public.learning_write_requests (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  payload jsonb not null,
  result jsonb,
  primary key (owner_id, request_id)
);
alter table public.learning_write_requests enable row level security;
revoke all on public.learning_write_requests from public, anon, authenticated;

create function public.begin_learning_write(p_request uuid, p_kind text, p_course uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.learning_write_requests;
begin
  if auth.uid() is null or not exists(select 1 from public.courses where id=p_course and owner_id=auth.uid()) then
    raise exception 'COURSE_NOT_FOUND' using errcode='42501';
  end if;
  if p_request is null then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request::text, 8104));
  select * into receipt from public.learning_write_requests where owner_id=auth.uid() and request_id=p_request;
  if found then
    if receipt.kind<>p_kind or receipt.course_id<>p_course or receipt.payload is distinct from p_payload then
      raise exception 'REQUEST_CONFLICT' using errcode='22023';
    end if;
    return receipt.result;
  end if;
  insert into public.learning_write_requests(owner_id,request_id,kind,course_id,payload)
    values(auth.uid(),p_request,p_kind,p_course,p_payload);
  return null;
end $$;
revoke all on function public.begin_learning_write(uuid,text,uuid,jsonb) from public,anon,authenticated;

create function public.save_course_summary(p_course uuid,p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mid uuid; sid uuid; updated timestamptz;
begin
  perform 1 from public.courses where id=p_course and owner_id=auth.uid() for update;
  if not found then raise exception 'COURSE_NOT_FOUND' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200
    or p_text is null or length(btrim(p_text)) not between 1 and 30000 then
    raise exception 'INVALID_SUMMARY' using errcode='22023';
  end if;
  select m.id,s.id into mid,sid from public.materials m join public.summaries s on s.material_id=m.id
    where m.course_id=p_course and m.type='summary' and s.source_file_id is null
      and s.generation_kind='manual' order by m.created_at,m.id limit 1;
  if sid is null then
    insert into public.materials(course_id,created_by,type,title)
      values(p_course,auth.uid(),'summary',btrim(p_title)) returning id into mid;
    insert into public.summaries(material_id,content,generation_kind)
      values(mid,jsonb_build_object('text',btrim(p_text)),'manual') returning id,updated_at into sid,updated;
  else
    update public.materials set title=btrim(p_title) where id=mid;
    update public.summaries set content=jsonb_build_object('text',btrim(p_text))
      where id=sid returning updated_at into updated;
  end if;
  return jsonb_build_object('material_id',mid,'summary_id',sid,'updated_at',updated);
end $$;

create function public.create_manual_deck(p_course uuid,p_title text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; mid uuid; did uuid;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'INVALID_TITLE' using errcode='22023'; end if;
  v_result:=public.begin_learning_write(p_request_id,'manual_deck',p_course,jsonb_build_object('title',btrim(p_title)));
  if v_result is not null then
    if not exists(select 1 from public.flashcard_decks where id=(v_result->>'deck_id')::uuid) then
      raise exception 'RESULT_DELETED' using errcode='55000'; end if;
    return v_result;
  end if;
  insert into public.materials(course_id,created_by,type,title)
    values(p_course,auth.uid(),'flashcard_deck',btrim(p_title)) returning id into mid;
  insert into public.flashcard_decks(material_id,title) values(mid,btrim(p_title)) returning id into did;
  v_result:=jsonb_build_object('material_id',mid,'deck_id',did);
  update public.learning_write_requests set result=v_result
    where owner_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create function public.update_learning_deck(p_material uuid,p_title text,p_description text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.materials m join public.courses c on c.id=m.course_id
    join public.flashcard_decks d on d.material_id=m.id
    where m.id=p_material and m.type='flashcard_deck' and c.owner_id=auth.uid() for update of m;
  if not found then raise exception 'DECK_NOT_FOUND' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_description,''))>2000 then
    raise exception 'INVALID_DECK' using errcode='22023'; end if;
  update public.materials set title=btrim(p_title),description=nullif(btrim(p_description),'') where id=p_material;
  update public.flashcard_decks set title=btrim(p_title),description=nullif(btrim(p_description),'') where material_id=p_material;
end $$;

create table public.flashcard_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  reviewed_at timestamptz,
  known boolean,
  starred boolean not null default false,
  repetition_count integer not null default 0 check(repetition_count>=0),
  interval_days integer not null default 0 check(interval_days between 0 and 365),
  due_at timestamptz,
  primary key(user_id,card_id)
);
create index flashcard_progress_due_idx on public.flashcard_progress(user_id,due_at) where due_at is not null;
alter table public.flashcard_progress enable row level security;
revoke all on public.flashcard_progress from public,anon,authenticated;
grant select on public.flashcard_progress to authenticated;
grant insert(user_id,card_id,starred),update(starred) on public.flashcard_progress to authenticated;
create policy flashcard_progress_owned on public.flashcard_progress for all to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.flashcards f where f.id=card_id))
  with check(user_id=auth.uid() and exists(select 1 from public.flashcards f where f.id=card_id));

create table public.flashcard_review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  request_id uuid not null,
  known boolean not null,
  reviewed_at timestamptz not null default now(),
  unique(user_id,request_id)
);
create index flashcard_review_events_user_idx on public.flashcard_review_events(user_id,reviewed_at desc);
alter table public.flashcard_review_events enable row level security;
revoke all on public.flashcard_review_events from public,anon,authenticated;
grant select on public.flashcard_review_events to authenticated;
create policy flashcard_review_events_owned on public.flashcard_review_events for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.flashcards f where f.id=card_id));

create function public.record_flashcard_review(p_card uuid,p_known boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; v_result jsonb; progress public.flashcard_progress; days integer;
begin
  select m.course_id into cid from public.flashcards f join public.flashcard_decks d on d.id=f.deck_id
    join public.materials m on m.id=d.material_id join public.courses c on c.id=m.course_id
    where f.id=p_card and c.owner_id=auth.uid();
  if cid is null then raise exception 'CARD_NOT_FOUND' using errcode='42501'; end if;
  if p_known is null then raise exception 'INVALID_REVIEW' using errcode='22023'; end if;
  v_result:=public.begin_learning_write(p_request_id,'review',cid,jsonb_build_object('card_id',p_card,'known',p_known));
  if v_result is not null then return v_result; end if;
  insert into public.flashcard_progress(user_id,card_id) values(auth.uid(),p_card) on conflict do nothing;
  select * into progress from public.flashcard_progress where user_id=auth.uid() and card_id=p_card for update;
  days:=case when not p_known or progress.interval_days=0 then 1 else least(365,progress.interval_days*2) end;
  update public.flashcard_progress set reviewed_at=now(),known=p_known,
    repetition_count=case when p_known then progress.repetition_count+1 else 0 end,
    interval_days=days,due_at=now()+make_interval(days=>days)
    where user_id=auth.uid() and card_id=p_card returning * into progress;
  insert into public.flashcard_review_events(user_id,card_id,request_id,known) values(auth.uid(),p_card,p_request_id,p_known);
  v_result:=to_jsonb(progress);
  update public.learning_write_requests set result=v_result
    where owner_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create function public.learning_deck_progress_counts(p_material_ids uuid[])
returns table(material_id uuid,total bigint,new bigint,reviewed bigint,known bigint,due bigint)
language sql stable security invoker set search_path='' as $$
  select m.id,count(f.id),count(f.id) filter(where p.reviewed_at is null),
    count(f.id) filter(where p.reviewed_at is not null),count(f.id) filter(where p.known is true),
    count(f.id) filter(where p.due_at<=now())
  from public.materials m join public.courses c on c.id=m.course_id
  join public.flashcard_decks d on d.material_id=m.id
  left join public.flashcards f on f.deck_id=d.id
  left join public.flashcard_progress p on p.card_id=f.id and p.user_id=auth.uid()
  where m.id=any(p_material_ids) and c.owner_id=auth.uid() group by m.id
$$;
revoke all on function public.save_course_summary(uuid,text,text),public.create_manual_deck(uuid,text,uuid),
  public.update_learning_deck(uuid,text,text),public.record_flashcard_review(uuid,boolean,uuid),
  public.learning_deck_progress_counts(uuid[]) from public,anon,authenticated;
grant execute on function public.save_course_summary(uuid,text,text),public.create_manual_deck(uuid,text,uuid),
  public.update_learning_deck(uuid,text,text),public.record_flashcard_review(uuid,boolean,uuid),
  public.learning_deck_progress_counts(uuid[]) to authenticated;
commit;
