// Explicit integration test; never runs against the development database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const container = 'lernapp-learning-test';
const args = [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-At',
];
const sql = (query) => execFileSync('docker', [...args, '-c', query], { encoding: 'utf8' }).trim();
const owner = '11111111-1111-1111-1111-111111111111';
const course = 'a2100000-0000-0000-0000-000000000001';
const source = 'a2100000-0000-0000-0000-000000000002';
const card = 'a2100000-0000-0000-0000-000000000003';
const auth = `set local role authenticated; set local request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';`;
const call = (query) => sql(`begin; ${auth} ${query}; commit;`).split('\n').at(-2);
const concurrent = (query) =>
  promisify(execFile)('docker', [
    ...args,
    '-c',
    `begin; ${auth} ${query}; select pg_sleep(0.15); commit;`,
  ]);

test(
  'Learning writes serialize retries, competing edits and independent reviews',
  { skip: process.env.LEARNING_DB_TEST !== '1' },
  async () => {
    try {
      sql(`insert into public.courses(id,owner_id,title) values('${course}','${owner}','Learning concurrency');
      insert into public.materials(id,course_id,created_by,type,title) values('${source}','${course}','${owner}','source_document','Source');`);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          concurrent(`select public.save_course_summary('${course}','Manual','Text')`),
        ),
      );
      assert.equal(
        sql(
          `select count(*) from public.summaries s join public.materials m on m.id=s.material_id where m.course_id='${course}'`,
        ),
        '1',
      );
      const deckCall = `select public.create_manual_deck('${course}','Deck','a2100000-0000-0000-0000-000000000010')`;
      const decks = await Promise.all(Array.from({ length: 4 }, () => concurrent(deckCall)));
      const getJson = (output) =>
        JSON.parse(output.split('\n').find((line) => line.startsWith('{')));
      const deck = getJson(decks[0].stdout);
      for (const result of decks) assert.deepEqual(getJson(result.stdout), deck);
      sql(
        `insert into public.flashcards(id,deck_id,question,answer) values('${card}','${deck.deck_id}','Q','A')`,
      );
      const review = `select public.record_flashcard_review('${card}',true,'a2100000-0000-0000-0000-000000000020')`;
      await Promise.all(Array.from({ length: 4 }, () => concurrent(review)));
      assert.equal(
        sql(`select repetition_count from public.flashcard_progress where card_id='${card}'`),
        '1',
      );
      await Promise.all(
        Array.from({ length: 3 }, () =>
          concurrent(`select public.record_flashcard_review('${card}',true,gen_random_uuid())`),
        ),
      );
      assert.equal(
        sql(`select repetition_count from public.flashcard_progress where card_id='${card}'`),
        '4',
      );
      assert.equal(
        sql(`select count(*) from public.flashcard_review_events where card_id='${card}'`),
        '4',
      );
      const edits = await Promise.allSettled(
        [1, 2].map((n) =>
          concurrent(
            `select public.save_learning_draft('${source}','summary','{"text":"Edit ${n}"}',0)`,
          ),
        ),
      );
      assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
      assert.match(edits.find((r) => r.status === 'rejected').reason.stderr, /DRAFT_CONFLICT/);
      const quizCall = `select public.save_learning_quiz('${source}','Quiz','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0}]','a2100000-0000-0000-0000-000000000030')`;
      const quizzes = await Promise.all(Array.from({ length: 3 }, () => concurrent(quizCall)));
      const quiz = getJson(quizzes[0].stdout);
      for (const result of quizzes) assert.deepEqual(getJson(result.stdout), quiz);
      const attempt = JSON.parse(
        call(
          `select public.start_learning_quiz_attempt('${quiz.quiz_id}','a2100000-0000-0000-0000-000000000040')`,
        ),
      );
      await Promise.all(
        Array.from({ length: 3 }, () =>
          concurrent(
            `select public.save_learning_quiz_attempt('${attempt.attempt_id}','[0]',1,true)`,
          ),
        ),
      );
      assert.equal(
        sql(`select revision from public.learning_quiz_attempts where id='${attempt.attempt_id}'`),
        '2',
      );
      assert.equal(
        sql(`select score from public.learning_quiz_attempts where id='${attempt.attempt_id}'`),
        '1',
      );
    } finally {
      sql(`delete from public.courses where id='${course}'`);
    }
  },
);
