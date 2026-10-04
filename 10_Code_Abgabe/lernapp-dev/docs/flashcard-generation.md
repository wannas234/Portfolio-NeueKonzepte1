# Course flashcards

The course flashcard page calls the `flashcards` Edge Function. Automatic scope
is the default; the user may instead request 1–300 cards as an upper target.
Only explicitly selected ready course documents enter the snapshot.

## Workflow and contract

All requests are authenticated POSTs to `flashcards`:

- `documents` / `list`: `course_id`; return selectable documents / recent unfinished jobs.
- `analyze`: `course_id`, `document_ids`, `request_id` UUID, `count` null (automatic) or integer.
- `status`, `generate`, `retry`, `cancel`: `job_id`.
- `save`: `job_id`, `title`, `cards: [{ id, question, answer }]` selected from review.

A job exposes `id`, `status`, `phase`, `analyzed`, `total`, `estimated_count`,
`generated`, `cards`, `sources`, `error_code`, `material_id`, `requested_count`.
Cards are returned only during review. Source references retain file and page
identifiers (document-only when extraction has no reliable page mapping).

The worker processes every source chunk, extracting distinct learning points.
A separate planning pass removes semantic overlap across documents and selects
points for coverage; automatic count equals the number of selected points.
At `estimated`, processing stops for user confirmation. `generate` resumes it,
producing at most eight cards per paid step. At `review` the user can edit or
exclude cards. Saving creates material, deck and all selected cards in one
transaction. Repeated saves return the same material. Cards retain provenance
in `additional_content`; generated cards display sources in the learning view.

Source IDs are checked against the input, but this does not establish factual
entailment. Users review generated claims. Original documents remain available.

## Persistence and safeguards

The service-only queue stores source snapshots, leases, checkpoints and budgets.
The API validates the user and the SQL layer verifies course ownership. Client
roles cannot call queue functions or read queue internals. A changed source
invalidates results; late workers cannot publish. Retries retain paid budgets.
The browser never stores job state in localStorage. Unsaved review edits stay
in memory; after page reload, the original generated review can be reopened.

Limits: 200 selected documents, 500,000 extracted characters (plus an allocation
bound for pages), 300 distinct candidate points, four unfinished jobs and ten
new jobs per hour per owner. Oversized courses fail explicitly and should be
split into smaller document selections. Per-chunk analysis supports up to 40
learning points. The provider is instructed to prioritize relevant learning
content; AI completeness is not guaranteed.

## Deployment

Apply `20261003120000_course_flashcard_generation.sql` after the existing summary
migrations. Deploy `flashcards` and `flashcards-process` together with the
frontend. Both handlers enforce their own authentication (`verify_jwt=false`).
The cron dispatch reuses the document worker URL/key in Vault and invokes the
new worker every ten seconds. It continues while the browser is closed.
The existing answer provider credentials and summary budget configuration are
reused; flashcard output allows 8192 tokens per model call. No extra secret.
No production migration or deployment is performed by the implementation task.

## Validation

- Deno unit tests: `supabase/functions/_shared/flashcard-generation_test.ts`.
- `npm run test:flashcards`: local PostgreSQL, real authenticated HTTP handlers,
  deterministic AI transport; tests estimates, worker resumption, ownership,
  invalid-card rollback, edited card persistence, concurrent admission/save,
  provenance, and source changes. No external model calls.
