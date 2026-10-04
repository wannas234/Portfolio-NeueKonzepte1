-- Dauer der Dokument-Pipeline (letzter Lauf je Dokument), neueste zuerst.
-- *_wait = anfängliche Wartezeit in der Queue (Cron-Takt).
-- *_duration = verstrichene Zeit, inklusive Pausen/Retry zwischen Worker-Aufrufen.
-- ocr_duration ist Teil von extraction_duration; nicht addieren.
-- Optional filtern: Dateinamen-Muster unten anpassen ('%' = alle).
select original_filename,
  processing_status, indexing_status, page_count, text_chars, chunk_count,
  upload_duration, processing_wait, extraction_duration, ocr_duration,
  indexing_wait, indexing_duration, total_duration,
  processing_claims, indexing_claims,
  upload_started_at, processing_started_at, processing_completed_at,
  indexing_started_at, indexing_completed_at, document_id
from public.document_pipeline_timings
where original_filename ilike '%'
order by upload_started_at desc
limit 20;

-- Kompletter Zeitstrahl eines Dokuments (jeder Claim, OCR-Schritt, Batch),
-- mit Abstand zum vorherigen Event und zum ersten protokollierten Event.
select e.occurred_at, e.event, e.detail,
  e.occurred_at - lag(e.occurred_at) over w as since_previous,
  e.occurred_at - first_value(e.occurred_at) over w as since_start
from public.document_pipeline_events e
where e.document_id = (
  select document_id from public.document_pipeline_timings
  where original_filename ilike '%' order by upload_started_at desc limit 1)
window w as (order by e.occurred_at, e.id)
order by e.occurred_at, e.id;



-------------

select original_filename as datei,
  upload_duration::interval(1) as upload,
  processing_wait::interval(1) as warten_auf_extraktion,
  extraction_duration::interval(1) as extraktion,
  ocr_duration::interval(1) as davon_ocr,
  indexing_wait::interval(1) as warten_auf_indexierung,
  indexing_duration::interval(1) as indexierung,
  total_duration::interval(1) as gesamt
from public.document_pipeline_timings
order by upload_started_at desc;
