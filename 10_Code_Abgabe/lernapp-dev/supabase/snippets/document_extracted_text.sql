-- Vollständiger extrahierter Text des zuletzt hochgeladenen passenden Dokuments.
-- Dateinamen-Muster anpassen, z. B. '%skript%'.
select f.original_filename, d.processing_status, d.page_count,
  length(d.extracted_text) as text_chars, d.extracted_text, d.id as document_id
from public.source_documents d
join public.materials m on m.id = d.material_id
join public.files f on f.id = m.file_id
where f.original_filename ilike '%'
order by f.created_at desc
limit 1;

-- Derselbe Text seitenweise, inkl. aller Metadaten, die die Extraktion je Seite
-- speichert (z. B. route/extraction beim Gemini-OCR).
select f.original_filename, (p.value->>'page')::int as page,
  length(p.value->>'text') as text_chars, p.value->>'text' as text, p.value - 'text' as page_meta
from public.source_documents d
join public.materials m on m.id = d.material_id
join public.files f on f.id = m.file_id
cross join lateral jsonb_array_elements(d.pages) p(value)
where d.id = (
  select d0.id from public.source_documents d0
  join public.materials m0 on m0.id = d0.material_id
  join public.files f0 on f0.id = m0.file_id
  where f0.original_filename ilike '%'
  order by f0.created_at desc limit 1)
order by page;





---------





-----




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




----



select string_agg(format(E'===== Seite %s / %s =====\n\n%s', p.value->>'page', d.page_count,
    p.value->>'text'), E'\n\n' order by (p.value->>'page')::int) as document_text
from public.source_documents d
cross join lateral jsonb_array_elements(d.pages) p(value)
where d.id = (
  select document_id from public.document_pipeline_timings
  where original_filename ilike '%Energie%'
  -- oder: where document_id = '...'
  order by upload_completed_at desc limit 1)
group by d.id;
