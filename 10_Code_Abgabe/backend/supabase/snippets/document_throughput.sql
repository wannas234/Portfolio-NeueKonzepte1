-- Operator-only; no document text or secrets. NULL means unmeasured, not zero.
select * from public.document_worker_metrics order by total_duration desc nulls last;
-- Per-page provenance, tokens, request attempts, selection reasons and configuration:
select document_id,worker,run_id,event,occurred_at,detail
from public.document_worker_events order by document_id,occurred_at;
