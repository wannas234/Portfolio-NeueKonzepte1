-- Replace percentage weighting with ECTS credits. grade_assessments was
-- already merged to dev (and is assumed deployed to the shared development
-- environment), so this is a follow-up migration rather than an edit of the
-- original file.
--
-- No general percent-to-ECTS conversion exists (a percentage weight and a
-- credit count are different units). This table has no production records
-- yet -- only local development/seed rows -- so existing rows are backfilled
-- with an explicit, clearly arbitrary placeholder (1 ECTS) rather than any
-- invented conversion from their old `weight` value.
begin;

-- Plain `numeric` (no fixed scale) rather than numeric(4,1): a fixed-scale
-- column silently rounds excess decimal digits on input instead of
-- rejecting them, which would make the "at most one decimal place" rule
-- below unenforceable. The check constraint enforces both the range and
-- the one-decimal-place limit against the exact value the client sent.
alter table public.grade_assessments add column ects_credits numeric;

update public.grade_assessments set ects_credits = 1 where ects_credits is null;

alter table public.grade_assessments
  alter column ects_credits set not null,
  add constraint grade_assessments_ects_credits_check check (
    ects_credits > 0 and ects_credits <= 60 and ects_credits = round(ects_credits, 1)
  );

alter table public.grade_assessments drop column weight;

grant insert (ects_credits) on public.grade_assessments to authenticated;
grant update (ects_credits) on public.grade_assessments to authenticated;

commit;
