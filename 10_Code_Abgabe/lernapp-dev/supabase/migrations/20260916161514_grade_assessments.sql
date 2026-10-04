-- Grade assessments. Ownership is derived entirely through courses.owner_id;
-- no redundant owner/creator column is stored on this table.
begin;

create table public.grade_assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind text not null check (kind in ('exam','presentation','assignment','project','exercise','oral_exam','other')),
  status text not null check (status in ('planned','submitted','graded')),
  weight numeric(5,2) not null check (weight > 0 and weight <= 100),
  grade numeric(3,2) check (grade is null or (grade >= 1 and grade <= 5)),
  assessment_date date,
  points_earned numeric(7,2) check (points_earned is null or points_earned >= 0),
  points_max numeric(7,2) check (points_max is null or points_max > 0),
  notes text check (notes is null or char_length(btrim(notes)) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grade_assessments_status_grade_check check (
    (status = 'graded' and grade is not null) or
    (status <> 'graded' and grade is null)
  ),
  constraint grade_assessments_points_check check (
    (points_earned is null and points_max is null) or
    (points_earned is not null and points_max is not null and points_earned <= points_max)
  )
);

alter table public.grade_assessments enable row level security;
revoke all on public.grade_assessments from anon, authenticated;

create trigger grade_assessments_set_updated_at before update on public.grade_assessments
  for each row execute function public.set_updated_at();

create index grade_assessments_course_id_assessment_date_idx on public.grade_assessments (course_id, assessment_date);

grant select, delete on public.grade_assessments to authenticated;
grant insert (id, course_id, title, kind, status, weight, grade, assessment_date, points_earned, points_max, notes)
  on public.grade_assessments to authenticated;
grant update (title, kind, status, weight, grade, assessment_date, points_earned, points_max, notes)
  on public.grade_assessments to authenticated;

create policy grade_assessments_select_owned on public.grade_assessments
  for select to authenticated using (
    exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))
  );

create policy grade_assessments_insert_owned on public.grade_assessments
  for insert to authenticated with check (
    exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))
  );

create policy grade_assessments_update_owned on public.grade_assessments
  for update to authenticated using (
    exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))
  );

create policy grade_assessments_delete_owned on public.grade_assessments
  for delete to authenticated using (
    exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))
  );

commit;
