begin;
create table public.learning_quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  source_material_id uuid not null references public.materials(id) on delete cascade,
  family_id uuid not null,
  revision integer not null check(revision>0),
  title text not null check(length(btrim(title)) between 1 and 200),
  questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 10),
  created_at timestamptz not null default now(),
  unique(family_id,revision)
);
create index learning_quizzes_source_idx on public.learning_quizzes(source_material_id,created_at desc);
alter table public.learning_quizzes enable row level security;
revoke all on public.learning_quizzes from public,anon,authenticated;
grant select on public.learning_quizzes to authenticated;
create policy learning_quizzes_owned on public.learning_quizzes for select to authenticated
  using(exists(select 1 from public.courses c where c.id=course_id));

create table public.learning_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  score integer,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_quiz_attempts_user_idx on public.learning_quiz_attempts(user_id,quiz_id,created_at desc);
alter table public.learning_quiz_attempts enable row level security;
revoke all on public.learning_quiz_attempts from public,anon,authenticated;
grant select on public.learning_quiz_attempts to authenticated;
create policy learning_quiz_attempts_owned on public.learning_quiz_attempts for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.learning_quizzes q where q.id=quiz_id));

create function public.save_learning_quiz(p_source_material uuid,p_title text,p_questions jsonb,p_request_id uuid,p_previous_quiz uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; v_result jsonb; q jsonb; opt jsonb; chunk jsonb; snapshot jsonb; refs jsonb;
  normalized jsonb:='[]'::jsonb; qid uuid:=gen_random_uuid(); previous public.learning_quizzes; family uuid; version integer;
begin
  select m.course_id into cid from public.materials m join public.courses c on c.id=m.course_id
    where m.id=p_source_material and m.type='source_document' and c.owner_id=auth.uid();
  if cid is null then raise exception 'SOURCE_NOT_FOUND' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'INVALID_QUIZ' using errcode='22023'; end if;
  if jsonb_array_length(p_questions) not between 1 and 10 or octet_length(p_questions::text)>100000 then
    raise exception 'INVALID_QUIZ' using errcode='22023'; end if;
  v_result:=public.begin_learning_write(p_request_id,'quiz',cid,
    jsonb_build_object('source_material_id',p_source_material,'title',btrim(p_title),'questions',p_questions,'previous_quiz',p_previous_quiz));
  if v_result is not null then return v_result; end if;
  -- Serialize revisions within a course; old question sets and attempts remain untouched.
  perform 1 from public.courses where id=cid for update;
  family:=qid; version:=1;
  if p_previous_quiz is not null then
    select * into previous from public.learning_quizzes where id=p_previous_quiz and source_material_id=p_source_material;
    if not found then raise exception 'QUIZ_NOT_FOUND' using errcode='42501'; end if;
    if exists(select 1 from public.learning_quizzes where family_id=previous.family_id and revision>previous.revision) then
      raise exception 'QUIZ_REVISION_CONFLICT' using errcode='40001'; end if;
    family:=previous.family_id; version:=previous.revision+1;
  end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'question') is distinct from 'string'
      or length(btrim(q->>'question')) not between 1 and 1000 or jsonb_typeof(q->'options') is distinct from 'array'
      or jsonb_typeof(q->'correctIndex') is distinct from 'number' then
      raise exception 'INVALID_QUESTION' using errcode='22023'; end if;
    if jsonb_array_length(q->'options')<>4 or (q->>'correctIndex')::numeric not between 0 and 3
      or trunc((q->>'correctIndex')::numeric)<>(q->>'correctIndex')::numeric then
      raise exception 'INVALID_QUESTION' using errcode='22023'; end if;
    for opt in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(opt) is distinct from 'string' or length(btrim(opt#>>'{}')) not between 1 and 2000 then
        raise exception 'INVALID_OPTION' using errcode='22023'; end if;
    end loop;
    refs:='[]';
    if q ? 'source_chunk_ids' then
      if jsonb_typeof(q->'source_chunk_ids') is distinct from 'array' then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
      if jsonb_array_length(q->'source_chunk_ids')>20 then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
      for chunk in select value from jsonb_array_elements(q->'source_chunk_ids') loop
        if jsonb_typeof(chunk) is distinct from 'string' then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
        select jsonb_build_object('source_document_id',d.id,'material_id',m.id,'chunk_id',c.id,
          'title',m.title,'page_number',c.page_number,'excerpt',left(c.content,4000)) into snapshot
          from public.document_chunks c join public.source_documents d on d.id=c.document_id
          join public.materials m on m.id=d.material_id where c.id=(chunk#>>'{}')::uuid and m.id=p_source_material;
        if snapshot is null then raise exception 'SOURCE_NOT_FOUND' using errcode='22023'; end if;
        refs:=refs||jsonb_build_array(snapshot);
      end loop;
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('question',btrim(q->>'question'),
      'options',q->'options','correctIndex',(q->>'correctIndex')::numeric,'sources',refs));
  end loop;
  insert into public.learning_quizzes(id,course_id,source_material_id,family_id,revision,title,questions)
    values(qid,cid,p_source_material,family,version,btrim(p_title),normalized);
  v_result:=jsonb_build_object('quiz_id',qid,'family_id',family,'revision',version);
  update public.learning_write_requests set result=v_result where owner_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create function public.start_learning_quiz_attempt(p_quiz uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; v_result jsonb; aid uuid;
begin
  select q.course_id into cid from public.learning_quizzes q join public.courses c on c.id=q.course_id
    where q.id=p_quiz and c.owner_id=auth.uid();
  if cid is null then raise exception 'QUIZ_NOT_FOUND' using errcode='42501'; end if;
  v_result:=public.begin_learning_write(p_request_id,'quiz_attempt',cid,jsonb_build_object('quiz_id',p_quiz));
  if v_result is not null then return v_result; end if;
  insert into public.learning_quiz_attempts(quiz_id,user_id) values(p_quiz,auth.uid()) returning id into aid;
  v_result:=jsonb_build_object('attempt_id',aid,'revision',1);
  update public.learning_write_requests set result=v_result where owner_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create function public.save_learning_quiz_attempt(p_attempt uuid,p_answers jsonb,p_expected_revision bigint,p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.learning_quiz_attempts; questions jsonb; answer jsonb; points integer:=0;
begin
  select a.* into attempt from public.learning_quiz_attempts a join public.learning_quizzes q on q.id=a.quiz_id
    join public.courses c on c.id=q.course_id where a.id=p_attempt and a.user_id=auth.uid() and c.owner_id=auth.uid() for update of a;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='42501'; end if;
  if p_submit is null or p_expected_revision is null or jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'INVALID_ANSWERS' using errcode='22023'; end if;
  -- Exact retries are safe even after submission; no second mutation or score calculation.
  if attempt.answers=p_answers and attempt.revision=p_expected_revision+1
    and (attempt.submitted_at is not null)=p_submit then return to_jsonb(attempt); end if;
  if attempt.submitted_at is not null then raise exception 'ATTEMPT_SUBMITTED' using errcode='55000'; end if;
  if attempt.revision<>p_expected_revision then raise exception 'ATTEMPT_CONFLICT' using errcode='40001'; end if;
  select q.questions into questions from public.learning_quizzes q where q.id=attempt.quiz_id;
  if jsonb_array_length(p_answers)>jsonb_array_length(questions)
    or (p_submit and jsonb_array_length(p_answers)<>jsonb_array_length(questions)) then
    raise exception 'INVALID_ANSWERS' using errcode='22023'; end if;
  for i in 0..jsonb_array_length(p_answers)-1 loop
    answer:=p_answers->i;
    if answer='null'::jsonb and not p_submit then continue; end if;
    if jsonb_typeof(answer) is distinct from 'number' then raise exception 'INVALID_ANSWERS' using errcode='22023'; end if;
    if (answer#>>'{}')::numeric not between 0 and 3 or trunc((answer#>>'{}')::numeric)<>(answer#>>'{}')::numeric then
      raise exception 'INVALID_ANSWERS' using errcode='22023'; end if;
    if answer=questions->i->'correctIndex' then points:=points+1; end if;
  end loop;
  update public.learning_quiz_attempts set answers=p_answers,revision=revision+1,updated_at=now(),
    submitted_at=case when p_submit then now() end,score=case when p_submit then points end
    where id=p_attempt returning * into attempt;
  return to_jsonb(attempt);
end $$;
revoke all on function public.save_learning_quiz(uuid,text,jsonb,uuid,uuid),public.start_learning_quiz_attempt(uuid,uuid),
  public.save_learning_quiz_attempt(uuid,jsonb,bigint,boolean) from public,anon,authenticated;
grant execute on function public.save_learning_quiz(uuid,text,jsonb,uuid,uuid),public.start_learning_quiz_attempt(uuid,uuid),
  public.save_learning_quiz_attempt(uuid,jsonb,bigint,boolean) to authenticated;
commit;
