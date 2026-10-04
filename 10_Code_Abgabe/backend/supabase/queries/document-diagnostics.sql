-- Beide Abfragen einzeln im lokalen Supabase SQL Editor ausführen.
-- Keine IDs einsetzen: Alle vorhandenen Dateien, neueste zuerst.

-- 1. Vollständiger Text: eine Zeile pro Datei, der gesamte Text in einem Feld.
select
  coalesce(f.original_filename, m.title) as "Datei",
  d.page_count as "Seiten",
  case when d.pages is null then d.extracted_text else (
    select string_agg(
      '--- Seite ' || (p->>'page') || E' ---\n' || (p->>'text'),
      E'\n\n' order by (p->>'page')::integer
    )
    from jsonb_array_elements(d.pages) p
  ) end as "Vollständiger Text"
from public.source_documents d
join public.materials m on m.id = d.material_id
left join public.files f on f.id = m.file_id
order by d.created_at desc, d.id;

-- 2. Zeitübersicht: eine Zeile pro Datei, sämtliche Dauern in Sekunden.
-- Extraktion/Indexierung sind Gesamtwerte, die Detailphasen sind darin enthalten.
-- Summen umfassen alle gemessenen Versuche/Batches, auch fehlgeschlagene.
-- NULL bedeutet: kein Messwert vorhanden (nicht 0 Sekunden).
with laufzeiten as (
  select
    document_id,
    min(started_at) as gestartet,
    max(completed_at) as letzte_messung,
    sum(duration_ms) filter (where worker = 'extraction') / 1000 as extraktion,
    sum(duration_ms) filter (where worker = 'indexing') / 1000 as indexierung
  from public.document_processing_runs
  group by document_id
), phasen as (
  select
    r.document_id,
    sum(p.duration_ms) filter (where p.phase = 'download') / 1000 as download,
    sum(p.duration_ms) filter (where p.phase = 'text_extraction') / 1000 as text_auslesen,
    sum(p.duration_ms) filter (where p.phase = 'chunking') / 1000 as text_aufteilen,
    sum(p.duration_ms) filter (where p.phase = 'embeddings') / 1000 as embeddings,
    sum(p.duration_ms) filter (where p.phase = 'persist') / 1000 as speichern
  from public.document_processing_runs r
  cross join lateral jsonb_to_recordset(r.phases) as p(
    phase text, duration_ms double precision
  )
  group by r.document_id
)
select
  coalesce(f.original_filename, m.title) as "Datei",
  case
    when d.processing_status = 'failed' or d.indexing_status = 'failed' then 'Fehlgeschlagen'
    when d.processing_status = 'ready' and d.indexing_status = 'ready' then 'Fertig'
    when d.processing_status = 'ready' then 'Indexierung ausstehend / läuft'
    when d.processing_status = 'uploaded' then 'Wartet auf Verarbeitung'
    else 'Textextraktion läuft'
  end as "Status",
  coalesce(l.gestartet, d.started_at) as "Verarbeitung gestartet",
  l.letzte_messung as "Letzte Messung beendet",
  round(coalesce(l.extraktion,
    extract(epoch from (d.completed_at - d.started_at)))::numeric, 3) as "Extraktion gesamt (s)",
  round(l.indexierung::numeric, 3) as "Indexierung gesamt (s)",
  round(p.download::numeric, 3) as "Download (s)",
  round(p.text_auslesen::numeric, 3) as "Text auslesen (s)",
  round(p.text_aufteilen::numeric, 3) as "Text aufteilen (s)",
  round(p.embeddings::numeric, 3) as "Embeddings (s)",
  round(p.speichern::numeric, 3) as "Speichern (s)"
from public.source_documents d
join public.materials m on m.id = d.material_id
left join public.files f on f.id = m.file_id
left join laufzeiten l on l.document_id = d.id
left join phasen p on p.document_id = d.id
order by d.created_at desc, d.id;
