-- Im SQL Editor des lokalen Supabase Studio ausführen:
-- http://127.0.0.1:54323
-- Jede nummerierte Abfrage ist einzeln ausführbar.
-- '%' findet alle Dateinamen; z. B. durch '%Energie%' ersetzen.

-- 1. Zeitpunkte und Dauer je Phase für die letzten 20 Dokumente.
-- Dauern sind verstrichene Zeit, einschließlich Pausen/Retry zwischen Workern.
-- OCR ist Teil der Extraktion, daher beide Dauern nicht addieren.
-- NULL bedeutet: Zeitpunkt nicht erfasst oder Phase noch nicht abgeschlossen.
select document_id, original_filename as datei,
  processing_status, indexing_status, page_count,
  upload_started_at, upload_completed_at,
  upload_duration::interval(1) as upload,
  processing_wait::interval(1) as warten_auf_extraktion,
  processing_started_at, processing_completed_at,
  extraction_duration::interval(1) as extraktion_inkl_pausen,
  ocr_started_at,
  ocr_duration::interval(1) as davon_ocr_inkl_pausen,
  indexing_wait::interval(1) as warten_auf_indexierung,
  indexing_started_at, indexing_completed_at,
  indexing_duration::interval(1) as indexierung_inkl_pausen,
  total_duration::interval(1) as gesamt,
  processing_claims, indexing_claims
from public.document_pipeline_timings
where original_filename ilike '%'
order by upload_started_at desc nulls last, document_id
limit 20;

-- 2. Vollständiger Text MIT Seitenzahlen in EINEM Ergebnisfeld.
-- Wählt den neuesten passenden Upload, dessen Extraktion fertig ist.
-- TXT hat keine Seiten: dort wird der vollständige Text direkt ausgegeben.
-- Für ein bestimmtes Dokument die Dateinamenbedingung ersetzen durch:
--   d.id = 'DEINE-DOKUMENT-UUID'::uuid
with selected as (
  select d.*, coalesce(f.original_filename, m.title) as datei
  from public.source_documents d
  join public.materials m on m.id = d.material_id
  left join public.files f on f.id = m.file_id
  where coalesce(f.original_filename, m.title) ilike '%'
    and d.processing_status = 'ready'
  order by d.created_at desc, d.id
  limit 1
)
select d.id as document_id, d.datei, d.page_count,
  case when d.pages is null then d.extracted_text else (
    select string_agg(
      format(E'===== Seite %s / %s =====\n\n%s',
        p.value->>'page', d.page_count, p.value->>'text'),
      E'\n\n' order by (p.value->>'page')::int
    )
    from jsonb_array_elements(d.pages) as p(value)
  ) end as vollstaendiger_text
from selected d;

-- 3. Eine Ergebniszeile pro PDF-Seite, einschließlich leerer Seiten.
-- text = maßgebliche Suchfassung, nativer_text = lokale Vergleichsfassung.
-- Für TXT erscheint eine Zeile ohne Seitenzahl.
with selected as (
  select d.*, coalesce(f.original_filename, m.title) as datei
  from public.source_documents d
  join public.materials m on m.id = d.material_id
  left join public.files f on f.id = m.file_id
  where coalesce(f.original_filename, m.title) ilike '%'
    and d.processing_status = 'ready'
  order by d.created_at desc, d.id
  limit 1
)
select d.id as document_id, d.datei,
  (p.value->>'page')::int as seite,
  case when d.pages is null then d.extracted_text else p.value->>'text' end as text,
  p.value->>'native_text' as nativer_text,
  p.value->>'route' as verarbeitung,
  p.value->'reasons' as auswahlgruende,
  p.value->'extraction' as extraktionsdetails
from selected d
left join lateral jsonb_array_elements(d.pages) as p(value) on true
order by seite;

-- 4. Alle Ereignisse des neuesten passenden Dokuments, auch während es läuft.
-- visual_done in detail zeigt die Anzahl bereits visuell extrahierter Seiten.
-- seit_erstem_ereignis beginnt beim ersten protokollierten Event, nicht Upload-Start.
select e.occurred_at as zeitpunkt, e.event, e.detail,
  e.occurred_at - lag(e.occurred_at) over w as seit_vorherigem_ereignis,
  e.occurred_at - first_value(e.occurred_at) over w as seit_erstem_ereignis
from public.document_pipeline_events e
where e.document_id = (
  select document_id from public.document_pipeline_timings
  where original_filename ilike '%'
  order by upload_completed_at desc, document_id
  limit 1
)
window w as (order by e.occurred_at, e.id)
order by e.occurred_at, e.id;
