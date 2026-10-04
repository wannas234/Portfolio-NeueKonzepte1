begin;

create table public.chat_history_summaries (
  conversation_id uuid primary key references public.chat_conversations(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  through_seq integer not null check (through_seq > 0),
  updated_at timestamptz not null default now()
);
alter table public.chat_history_summaries enable row level security;
revoke all on public.chat_history_summaries from public, anon, authenticated;
grant select on public.chat_history_summaries to authenticated;
grant all on public.chat_history_summaries to service_role;
create policy chat_history_summaries_read_owned on public.chat_history_summaries
  for select to authenticated using (exists (
    select 1 from public.chat_conversations c where c.id = conversation_id
  ));

create function public.save_chat_history_summary(p_user_id uuid, p_conversation_id uuid,
  p_request_id uuid, p_lease_token uuid, p_previous_seq integer, p_through_seq integer,
  p_content text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.chat_requests; current_seq integer;
begin
  -- Same lock order as completion. Ownership and expiry are checked under lock.
  perform 1 from public.chat_conversations c join public.courses co on co.id = c.course_id
    where c.id = p_conversation_id and co.owner_id = p_user_id for update of c for share of co;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into r from public.chat_requests
    where conversation_id = p_conversation_id and request_id = p_request_id for update;
  if not found or r.user_id <> p_user_id or r.lease_token is distinct from p_lease_token
    or r.status <> 'running' or r.lease_until <= clock_timestamp() then
    raise exception 'REQUEST_LEASE_EXPIRED' using errcode = 'P0001';
  end if;
  select through_seq into current_seq from public.chat_history_summaries
    where conversation_id = p_conversation_id;
  if p_previous_seq is distinct from coalesce(current_seq, 0) then return false; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 2000
    or p_through_seq is null or p_through_seq <= p_previous_seq
    or p_through_seq::bigint - p_previous_seq > 20
    or (select count(*) from public.chat_messages where conversation_id = p_conversation_id
      and seq > p_previous_seq and seq <= p_through_seq) <> p_through_seq::bigint - p_previous_seq then
    raise exception 'INVALID_CHAT_SUMMARY' using errcode = '22023';
  end if;
  insert into public.chat_history_summaries(conversation_id, content, through_seq)
    values (p_conversation_id, btrim(p_content), p_through_seq)
    on conflict (conversation_id) do update set content = excluded.content,
      through_seq = excluded.through_seq, updated_at = clock_timestamp();
  return true;
end;
$$;
revoke all on function public.save_chat_history_summary(uuid,uuid,uuid,uuid,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.save_chat_history_summary(uuid,uuid,uuid,uuid,integer,integer,text)
  to service_role;
commit;
