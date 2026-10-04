-- Feedback-Signal je Antwort (Issue #55). Die Bewertung gehört zur Antwort und
-- lebt deshalb auf chat_messages selbst: eine eigene Tabelle hätte dieselbe
-- 1:1-Beziehung nur über einen zusätzlichen Join und vier weitere Policies
-- nachgebildet. Schreibbar wird ausschließlich diese eine Spalte.
begin;

alter table public.chat_messages
  add column helpful boolean,
  -- Wann bewertet wurde, ist die Zeitachse der Qualitätsanalyse: created_at ist
  -- der Zeitpunkt der Antwort, nicht der Bewertung.
  add column helpful_at timestamptz,
  add constraint chat_messages_helpful_role check (
    role = 'assistant' or (helpful is null and helpful_at is null)),
  add constraint chat_messages_helpful_at check ((helpful is null) = (helpful_at is null));

-- Bewertete Antworten sind eine kleine Teilmenge; der Teilindex trägt die
-- Auswertung, ohne den Verlauf zu belasten.
create index chat_messages_helpful_idx on public.chat_messages(helpful_at desc)
  where helpful is not null;

-- Der Zeitstempel ist Servereigentum: der Client erhält kein Grant darauf und
-- kann eine Bewertung damit weder vordatieren noch nachdatieren.
create function public.chat_messages_stamp_helpful() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.helpful is distinct from old.helpful then
    new.helpful_at := case when new.helpful is null then null else now() end;
  end if;
  return new;
end;
$$;
create trigger chat_messages_stamp_helpful before update on public.chat_messages
  for each row execute function public.chat_messages_stamp_helpful();

-- Erstes Schreibrecht von Clients auf chat_messages. Das Spalten-Grant begrenzt
-- es exakt auf helpful; content, seq, model und die Tokenzahlen bleiben ohne
-- Grant und damit unveränderlich, unabhängig von der Policy.
grant update (helpful) on public.chat_messages to authenticated;
create policy chat_messages_rate_owned on public.chat_messages for update to authenticated
  using (role = 'assistant' and exists (
    select 1 from public.chat_conversations c
      join public.courses co on co.id = c.course_id
      where c.id = conversation_id and co.owner_id = (select auth.uid())))
  with check (role = 'assistant' and exists (
    select 1 from public.chat_conversations c
      join public.courses co on co.id = c.course_id
      where c.id = conversation_id and co.owner_id = (select auth.uid())));

-- Auch wiederhergestellte Exchanges enthalten den aktuellen Feedback-Zustand.
create or replace function public.chat_exchange_payload(p_message_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('conversation_id', q.conversation_id, 'request_id', q.request_id,
    'messages', jsonb_build_array(
      jsonb_build_object('id', q.id, 'seq', q.seq, 'role', q.role,
        'content', q.content, 'created_at', q.created_at),
      jsonb_build_object('id', a.id, 'seq', a.seq, 'role', a.role,
        'content', a.content, 'model', a.model, 'provider', a.provider,
        'helpful', a.helpful, 'helpful_at', a.helpful_at,
        'input_tokens', a.input_tokens, 'output_tokens', a.output_tokens, 'created_at', a.created_at)),
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

-- Auswertung über alle Nutzer hinweg: eine Betriebssicht, kein Client-Feature.
-- Definer, damit die Zeilen-RLS der einzelnen Besitzer sie nicht leert.
-- Aktueller Zustand nach letzter Bewertungsänderung, keine Ereignishistorie.
-- Änderungen verschieben die Bewertung in ein anderes Zeitfenster; null entfernt sie.
create function public.chat_feedback_stats(p_from timestamptz default null,
  p_to timestamptz default null)
  returns table (provider text, model text, helpful_count bigint, not_helpful_count bigint)
language sql stable security definer set search_path = '' as $$
  select m.provider, m.model,
    count(*) filter (where m.helpful),
    count(*) filter (where not m.helpful)
  from public.chat_messages m
  where m.helpful is not null
    and (p_from is null or m.helpful_at >= p_from)
    and (p_to is null or m.helpful_at < p_to)
  group by m.provider, m.model;
$$;
revoke all on function public.chat_messages_stamp_helpful(),
  public.chat_feedback_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_feedback_stats(timestamptz, timestamptz) to service_role;
commit;
