begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.courses(id,owner_id,title) values
 ('99200000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Grades test (own)');
insert into public.courses(id,owner_id,title) values
 ('99200000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Grades test (foreign)');

-- 1. Schema shape.
select has_table('public', 'grade_assessments', 'Tabelle grade_assessments existiert');
select is((select relrowsecurity from pg_class where oid = 'public.grade_assessments'::regclass), true, 'grade_assessments: RLS aktiviert');
select has_column('public', 'grade_assessments', 'id', 'Spalte id existiert');
select has_column('public', 'grade_assessments', 'course_id', 'Spalte course_id existiert');
select has_column('public', 'grade_assessments', 'title', 'Spalte title existiert');
select has_column('public', 'grade_assessments', 'kind', 'Spalte kind existiert');
select has_column('public', 'grade_assessments', 'status', 'Spalte status existiert');
select has_column('public', 'grade_assessments', 'ects_credits', 'Spalte ects_credits existiert');
select hasnt_column('public', 'grade_assessments', 'weight', 'Spalte weight ist im endgueltigen Vertrag entfernt');
select has_column('public', 'grade_assessments', 'grade', 'Spalte grade existiert');
select has_column('public', 'grade_assessments', 'assessment_date', 'Spalte assessment_date existiert');
select has_column('public', 'grade_assessments', 'points_earned', 'Spalte points_earned existiert');
select has_column('public', 'grade_assessments', 'points_max', 'Spalte points_max existiert');
select has_column('public', 'grade_assessments', 'notes', 'Spalte notes existiert');
select has_column('public', 'grade_assessments', 'created_at', 'Spalte created_at existiert');
select has_column('public', 'grade_assessments', 'updated_at', 'Spalte updated_at existiert');

-- FK: bogus course_id is rejected. Tested as superuser (RLS bypassed) so the
-- foreign key constraint itself is isolated from the ownership check, which
-- would otherwise also reject a non-existent/unowned course_id with 42501.
select throws_ok($$
  insert into public.grade_assessments(course_id,title,kind,status,ects_credits)
  values ('99200000-0000-0000-0000-000000000099','Bogus','exam','planned',5)
$$,'23503',null,'Unbekannte course_id wird abgewiesen (FK)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 2. Owner can create an assessment for their own course.
select lives_ok($$
  insert into public.grade_assessments(id,course_id,title,kind,status,ects_credits)
  values ('99200000-0000-0000-0000-000000000010','99200000-0000-0000-0000-000000000001','Klausur','exam','planned',6)
$$,'Owner can create an assessment for their own course');

select lives_ok($$
  insert into public.grade_assessments(id,course_id,title,kind,status,ects_credits,grade,assessment_date)
  values ('99200000-0000-0000-0000-000000000011','99200000-0000-0000-0000-000000000001','Projekt','project','graded',4.5,1.7,'2026-11-20')
$$,'Owner can create a graded assessment with half-ECTS credits');

-- 3. Owner can read their own assessments.
select is((select count(*)::int from public.grade_assessments where id in ('99200000-0000-0000-0000-000000000010','99200000-0000-0000-0000-000000000011')),2,'Owner sees both of their assessments');

-- 4. Owner can edit their own content.
reset role;
update public.grade_assessments
set updated_at = '2000-01-01 00:00:00+00'
where id = '99200000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  update public.grade_assessments set title='Klausur (verschoben)', assessment_date='2027-02-01' where id='99200000-0000-0000-0000-000000000010'
$$,'Owner can edit their own assessment');
select isnt(
  (select updated_at::text from public.grade_assessments where id='99200000-0000-0000-0000-000000000010'),
  '2000-01-01 00:00:00+00',
  'updated_at wird vom Trigger gepflegt'
);

-- 7. Cannot create an assessment for a foreign course.
select throws_ok($$
  insert into public.grade_assessments(course_id,title,kind,status,ects_credits)
  values ('99200000-0000-0000-0000-000000000002','Fremdkurs','exam','planned',5)
$$,'42501',null,'Cannot create an assessment for a foreign course');

-- 10. Invalid ECTS are rejected.
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',0)$$,'23514',null,'0 ECTS wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',-3)$$,'23514',null,'Negative ECTS werden abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',60.01)$$,'23514',null,'ECTS über 60 werden abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',2.55)$$,'23514',null,'ECTS mit mehr als einer Nachkommastelle werden abgewiesen');
select lives_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',0.5)$$,'0,5 ECTS ist gueltig');

-- 11. Invalid grades are rejected.
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,grade) values ('99200000-0000-0000-0000-000000000001','x','exam','graded',5,0.5)$$,'23514',null,'Note unter 1,0 wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,grade) values ('99200000-0000-0000-0000-000000000001','x','exam','graded',5,5.5)$$,'23514',null,'Note über 5,0 wird abgewiesen');

-- 12. graded without a grade is rejected.
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits) values ('99200000-0000-0000-0000-000000000001','x','exam','graded',5)$$,'23514',null,'graded ohne Note wird abgewiesen');

-- 13. Non-graded status with a grade, and inconsistent/invalid points, are rejected.
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,grade) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5,2.0)$$,'23514',null,'planned mit gesetzter Note wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,points_earned) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5,10)$$,'23514',null,'Nur points_earned ohne points_max wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,points_max) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5,10)$$,'23514',null,'Nur points_max ohne points_earned wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,points_earned,points_max) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5,15,10)$$,'23514',null,'points_earned über points_max wird abgewiesen');
select throws_ok($$insert into public.grade_assessments(course_id,title,kind,status,ects_credits,points_max) values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5,0)$$,'23514',null,'points_max muss größer 0 sein');

-- 16. Protected columns cannot be changed by a normal client update.
select throws_ok($$
  update public.grade_assessments set course_id='99200000-0000-0000-0000-000000000002' where id='99200000-0000-0000-0000-000000000010'
$$,'42501',null,'course_id ist nicht per Update änderbar');
select throws_ok($$
  update public.grade_assessments set id='99200000-0000-0000-0000-000000000099' where id='99200000-0000-0000-0000-000000000010'
$$,'42501',null,'id ist nicht per Update änderbar');
select throws_ok($$
  update public.grade_assessments set created_at=now() where id='99200000-0000-0000-0000-000000000010'
$$,'42501',null,'created_at ist nicht per Update änderbar');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 6. Foreign user sees nothing.
select is((select count(*)::int from public.grade_assessments where course_id='99200000-0000-0000-0000-000000000001'),0,'Foreign user sees no assessments of the other course');

-- 8. Foreign update/delete affects no rows.
update public.grade_assessments set title='hacked' where id='99200000-0000-0000-0000-000000000010';
delete from public.grade_assessments where id='99200000-0000-0000-0000-000000000011';

reset role;
select is((select count(*)::int from public.grade_assessments where id='99200000-0000-0000-0000-000000000010' and title='hacked'),0,'Foreign update affects no rows');
select is((select count(*)::int from public.grade_assessments where id='99200000-0000-0000-0000-000000000011'),1,'Foreign delete affects no rows');

-- 9. Anonymous access is blocked.
set local role anon;
select throws_ok($$select * from public.grade_assessments$$,'42501',null,'Anonymous select is denied');
select throws_ok($$
  insert into public.grade_assessments(course_id,title,kind,status,ects_credits)
  values ('99200000-0000-0000-0000-000000000001','x','exam','planned',5)
$$,'42501',null,'Anonymous insert is denied');
reset role;

-- 5. Owner can delete their own assessment.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$delete from public.grade_assessments where id='99200000-0000-0000-0000-000000000011'$$,'Owner can delete their own assessment');
reset role;

-- 15. Deleting a course cascades to its assessments.
delete from public.courses where id='99200000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.grade_assessments where id='99200000-0000-0000-0000-000000000010'),0,'Course cascade removes its assessments');

select * from finish();
rollback;
