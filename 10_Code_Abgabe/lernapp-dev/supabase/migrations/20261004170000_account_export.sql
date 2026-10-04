-- Datenexport nach Art. 15/20 DSGVO (Edge Function `account-export`).
--
-- export_my_data() liefert alle personenbezogenen Daten des aufrufenden Nutzers als jsonb.
-- Wer exportiert wird, bestimmt allein der JWT (auth.uid()); jede Teilmenge ist explizit auf
-- den Nutzer gefiltert, nicht nur über RLS. Nicht enthalten sind abgeleitete technische Daten
-- (Embeddings, Chunks, extrahierter Text, Job-/Lease-Zustände). Die Original-Dateien verlinkt
-- die Edge Function per Signed URL; storage_path wird dafür mitgeliefert und dort entfernt.
--
-- account_exports begrenzt die Exporte auf 3 pro 24 Stunden. Die Zeilen hängen am Profil und
-- verschwinden mit dem Konto.
begin;

create table public.account_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index account_exports_window on public.account_exports(user_id, created_at);
alter table public.account_exports enable row level security;
revoke all on public.account_exports from public, anon, authenticated;
grant all on public.account_exports to service_role;

create function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_recent timestamptz;
  v_courses uuid[];
  v_materials uuid[];
  v_conversations uuid[];
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- Serialisiert parallele Exporte desselben Nutzers: Zählen und Eintragen sind atomar.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 8302));
  select min(created_at) into v_recent from (
    select created_at from public.account_exports
      where user_id = v_user and created_at > now() - interval '24 hours'
      order by created_at desc limit 3) r
    having count(*) >= 3;
  if v_recent is not null then
    return jsonb_build_object('allowed', false, 'code', 'RATE_LIMITED',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        (v_recent + interval '24 hours' - now())))::integer));
  end if;
  insert into public.account_exports(user_id) values (v_user);

  select coalesce(array_agg(id), '{}') into v_courses from public.courses where owner_id = v_user;
  select coalesce(array_agg(id), '{}') into v_materials
    from public.materials where course_id = any(v_courses);
  select coalesce(array_agg(id), '{}') into v_conversations
    from public.chat_conversations where course_id = any(v_courses);

  return jsonb_build_object('allowed', true, 'data', jsonb_build_object(
    'profile', (select to_jsonb(p) - 'user_id' from public.profiles p where p.id = v_user),
    'subscription', (select to_jsonb(s) - 'user_id' from public.subscriptions s
      where s.user_id = v_user),
    'courses', coalesce((select jsonb_agg(to_jsonb(c) - 'owner_id' order by c.created_at)
      from public.courses c where c.id = any(v_courses)), '[]'),
    'lectures', coalesce((select jsonb_agg(to_jsonb(l) order by l.course_id, l.held_on)
      from public.lectures l where l.course_id = any(v_courses)), '[]'),
    'materials', coalesce((select jsonb_agg(to_jsonb(m) - 'created_by' order by m.created_at)
      from public.materials m where m.id = any(v_materials)), '[]'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'course_id', f.course_id,
        'original_filename', f.original_filename, 'mime_type', f.mime_type,
        'size_bytes', f.size_bytes, 'status', f.status, 'created_at', f.created_at,
        'storage_path', f.storage_path) order by f.created_at)
      from public.files f where f.uploaded_by = v_user and f.status <> 'deleting'), '[]'),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at)
      from public.documents d where d.material_id = any(v_materials)), '[]'),
    'document_notes', coalesce((select jsonb_agg(to_jsonb(n) - 'user_id' order by n.created_at)
      from public.document_notes n where n.user_id = v_user), '[]'),
    'presentations', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('slides',
        coalesce((select jsonb_agg(to_jsonb(s) - 'presentation_id' order by s.slide_number)
          from public.presentation_slides s where s.presentation_id = p.id), '[]'))
        order by p.created_at)
      from public.presentations p where p.material_id = any(v_materials)), '[]'),
    'summaries', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
      from public.summaries s where s.material_id = any(v_materials)), '[]'),
    'flashcard_decks', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('cards',
        coalesce((select jsonb_agg(to_jsonb(f) - 'deck_id' order by f.created_at)
          from public.flashcards f where f.deck_id = d.id), '[]'))
        order by d.created_at)
      from public.flashcard_decks d where d.material_id = any(v_materials)), '[]'),
    'flashcard_progress', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id')
      from public.flashcard_progress p where p.user_id = v_user), '[]'),
    'flashcard_reviews', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' - 'request_id'
        order by r.reviewed_at)
      from public.flashcard_review_events r where r.user_id = v_user), '[]'),
    'quizzes', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at)
      from public.learning_quizzes q where q.course_id = any(v_courses)), '[]'),
    'quiz_attempts', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.created_at)
      from public.learning_quiz_attempts a where a.user_id = v_user), '[]'),
    'learning_drafts', coalesce((select jsonb_agg(to_jsonb(d) - 'user_id')
      from public.learning_drafts d where d.user_id = v_user), '[]'),
    'grades', coalesce((select jsonb_agg(to_jsonb(g) order by g.course_id, g.created_at)
      from public.grade_assessments g where g.course_id = any(v_courses)), '[]'),
    'calendar_events', coalesce((select jsonb_agg(to_jsonb(e) - 'owner_id' order by e.starts_at)
      from public.calendar_events e where e.owner_id = v_user), '[]'),
    'material_analyses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id,
        'material_id', a.material_id, 'status', a.status, 'items', a.items,
        'warnings', a.warnings, 'created_at', a.created_at) order by a.created_at)
      from public.material_analyses a where a.owner_id = v_user), '[]'),
    'chat_conversations', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'messages', coalesce((select jsonb_agg(jsonb_build_object('role', m.role,
            'content', m.content, 'created_at', m.created_at, 'helpful', m.helpful,
            'material_ids', m.material_ids, 'sources',
            coalesce((select jsonb_agg(jsonb_build_object('citation_no', s.citation_no,
                'material_id', s.material_id, 'material_title', s.material_title,
                'page_number', s.page_number, 'excerpt', s.excerpt) order by s.citation_no)
              from public.chat_message_sources s where s.message_id = m.id), '[]'))
            order by m.seq)
          from public.chat_messages m where m.conversation_id = c.id), '[]'))
        order by c.created_at)
      from public.chat_conversations c where c.id = any(v_conversations)), '[]'),
    'usage_events', coalesce((select jsonb_agg(to_jsonb(u) - 'user_id' order by u.created_at)
      from public.usage_events u where u.user_id = v_user), '[]')
  ));
end;
$$;
revoke all on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;

commit;
