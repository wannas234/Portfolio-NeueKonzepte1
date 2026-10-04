-- Chat über indexierte Lernmaterialien. Antworten und Quellen sind servergeschrieben.
begin;

-- No own owner_id: a course already has exactly one owner and there is no
-- membership table, so conversation -> course -> owner is unique. A second copy
-- could drift from courses.owner_id; the course policies enforce ownership.
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null default 'Neuer Chat' check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_conversations_course_updated_idx on public.chat_conversations(course_id, updated_at desc);
create trigger chat_conversations_set_updated_at before update on public.chat_conversations
  for each row execute function public.set_updated_at();
alter table public.chat_conversations enable row level security;
revoke all on public.chat_conversations from public, anon, authenticated;
grant select, delete on public.chat_conversations to authenticated;
grant insert (id, course_id, title) on public.chat_conversations to authenticated;
grant update (title) on public.chat_conversations to authenticated;
grant all on public.chat_conversations to service_role;
create policy chat_conversations_select_owned on public.chat_conversations for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id));
create policy chat_conversations_insert_owned on public.chat_conversations for insert to authenticated
  with check (exists (select 1 from public.courses c where c.id = course_id));
create policy chat_conversations_update_owned on public.chat_conversations for update to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id))
  with check (exists (select 1 from public.courses c where c.id = course_id));
create policy chat_conversations_delete_owned on public.chat_conversations for delete to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id));

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  seq integer not null check (seq >= 1),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 8000),
  model text check (char_length(btrim(model)) between 1 and 100),
  request_id uuid,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  unique (id, role),
  check ((role = 'user') = (request_id is not null)),
  check ((role = 'assistant') = (model is not null))
);
-- A retried request must resolve to the stored exchange instead of a duplicate.
create unique index chat_messages_request_idx on public.chat_messages(conversation_id, request_id)
  where role = 'user';
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public, anon, authenticated;
grant select on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
create policy chat_messages_select_owned on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id));

-- Snapshots outlive their source: reindexing replaces chunks and materials can be
-- deleted, but an old answer must keep the citation it was written with.
create table public.chat_message_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  message_role text generated always as ('assistant'::text) stored,
  citation_no integer not null check (citation_no between 1 and 20),
  chunk_id uuid references public.document_chunks(id) on delete set null,
  source_document_id uuid references public.source_documents(id) on delete set null,
  material_id uuid references public.materials(id) on delete set null,
  material_title text not null check (char_length(btrim(material_title)) between 1 and 200),
  page_number integer check (page_number > 0),
  excerpt text not null check (char_length(btrim(excerpt)) between 1 and 4000),
  similarity double precision not null check (similarity between -1 and 1),
  created_at timestamptz not null default now(),
  foreign key (message_id, message_role) references public.chat_messages(id, role) on delete cascade,
  unique (message_id, citation_no)
);
create index chat_message_sources_chunk_idx on public.chat_message_sources(chunk_id);
alter table public.chat_message_sources enable row level security;
revoke all on public.chat_message_sources from public, anon, authenticated;
grant select on public.chat_message_sources to authenticated;
grant all on public.chat_message_sources to service_role;
create policy chat_message_sources_select_owned on public.chat_message_sources for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id));

-- Internal helper: the caller already runs as owner, so it needs no grants.
create function public.chat_exchange_payload(p_message_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('conversation_id', q.conversation_id,
    'messages', jsonb_build_array(
      jsonb_build_object('id', q.id, 'seq', q.seq, 'role', q.role,
        'content', q.content, 'created_at', q.created_at),
      jsonb_build_object('id', a.id, 'seq', a.seq, 'role', a.role,
        'content', a.content, 'model', a.model, 'created_at', a.created_at)),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'citation_no', s.citation_no, 'chunk_id', s.chunk_id,
        'source_document_id', s.source_document_id, 'material_id', s.material_id,
        'material_title', s.material_title, 'page_number', s.page_number,
        'excerpt', s.excerpt, 'similarity', s.similarity) order by s.citation_no)
      from public.chat_message_sources s where s.message_id = a.id), '[]'::jsonb))
  from public.chat_messages q join public.chat_messages a
    on a.conversation_id = q.conversation_id and a.seq = q.seq + 1 and a.role = 'assistant'
  where q.id = p_message_id;
$$;

-- Lets a client recognise its own retry before anything is paid for again.
-- Definer, so the private payload helper stays out of reach; the join to
-- courses.owner_id is the same ownership rule the policies rely on.
create function public.chat_exchange(p_conversation_id uuid, p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m uuid;
begin
  select msg.id into m from public.chat_messages msg
    join public.chat_conversations c on c.id = msg.conversation_id
    join public.courses co on co.id = c.course_id
    where msg.conversation_id = p_conversation_id and msg.role = 'user'
      and msg.request_id = p_request_id and co.owner_id = auth.uid();
  if not found then return null; end if;
  return public.chat_exchange_payload(m);
end;
$$;

-- Question, answer and citations commit together. The row lock serialises
-- concurrent questions before sequence numbers are derived.
create function public.append_chat_exchange(p_conversation_id uuid, p_request_id uuid,
  p_question text, p_answer text, p_model text, p_sources jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.chat_conversations; q public.chat_messages; a public.chat_messages; n integer;
begin
  select * into c from public.chat_conversations where id = p_conversation_id for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into q from public.chat_messages
    where conversation_id = c.id and role = 'user' and request_id = p_request_id;
  if found then return public.chat_exchange_payload(q.id); end if;
  if p_request_id is null or p_question is null or p_answer is null or p_model is null
    or char_length(btrim(p_question)) not between 1 and 8000
    or char_length(btrim(p_answer)) not between 1 and 8000
    or char_length(btrim(p_model)) not between 1 and 100
    or p_sources is null or jsonb_typeof(p_sources) <> 'array'
    or jsonb_array_length(p_sources) > 20 or exists (
      select 1 from jsonb_array_elements(p_sources) s
      where jsonb_typeof(s) is distinct from 'object'
        or jsonb_typeof(s->'citation_no') is distinct from 'number'
        or jsonb_typeof(s->'chunk_id') is distinct from 'string'
        or jsonb_typeof(s->'source_document_id') is distinct from 'string'
        or jsonb_typeof(s->'material_id') is distinct from 'string'
        or jsonb_typeof(s->'material_title') is distinct from 'string'
        or jsonb_typeof(s->'excerpt') is distinct from 'string'
        or jsonb_typeof(s->'similarity') is distinct from 'number'
        or coalesce(jsonb_typeof(s->'page_number'), 'null') not in ('number', 'null')) then
    raise exception 'INVALID_CHAT_EXCHANGE' using errcode = '22023';
  end if;
  -- Citations may skip numbers; the model cites only some of the passages.
  if exists (select 1 from jsonb_array_elements(p_sources) s where not exists (
      select 1 from public.document_chunks ch
      join public.source_documents d on d.id = ch.document_id
      join public.materials m on m.id = d.material_id
      where ch.id = (s->>'chunk_id')::uuid and d.id = (s->>'source_document_id')::uuid
        and m.id = (s->>'material_id')::uuid and m.course_id = c.course_id
        and d.indexing_status = 'ready')) then
    raise exception 'INVALID_CHAT_EXCHANGE' using errcode = '22023';
  end if;
  select coalesce(max(seq), 0) into n from public.chat_messages where conversation_id = c.id;
  insert into public.chat_messages(conversation_id, seq, role, content, request_id)
    values (c.id, n + 1, 'user', p_question, p_request_id) returning * into q;
  insert into public.chat_messages(conversation_id, seq, role, content, model)
    values (c.id, n + 2, 'assistant', p_answer, p_model) returning * into a;
  insert into public.chat_message_sources(message_id, citation_no, chunk_id, source_document_id,
    material_id, material_title, page_number, excerpt, similarity)
    select a.id, (s->>'citation_no')::integer, (s->>'chunk_id')::uuid,
      (s->>'source_document_id')::uuid, (s->>'material_id')::uuid, s->>'material_title',
      (s->>'page_number')::integer, s->>'excerpt', (s->>'similarity')::double precision
    from jsonb_array_elements(p_sources) s;
  -- Always an update, so the trigger keeps updated_at current for chat lists.
  update public.chat_conversations set title = case when title = 'Neuer Chat'
    then btrim(left(btrim(p_question), 120)) else title end where id = c.id;
  return public.chat_exchange_payload(q.id);
end;
$$;
revoke all on function public.chat_exchange_payload(uuid), public.chat_exchange(uuid, uuid),
  public.append_chat_exchange(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_chat_exchange(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.chat_exchange(uuid, uuid) to authenticated, service_role;
commit;
