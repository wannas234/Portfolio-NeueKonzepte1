# Document quiz generation

The document Tests tab uses `quizzes`, not a temporary chat. It generates 1–10
multiple-choice questions (default 5) from one ready, indexed source material.
The requested number is an upper target: fewer supported learning points produce
fewer questions. No suitable learning content fails explicitly. This is a
self-study tool: owners can read solutions; it is not an exam security boundary.

## Contract

Authenticated POSTs to `quizzes`:

- `generate`: `source_material_id`, `count` (integer 1–10), `request_id` UUID.
- `list`: `source_material_id`; returns the latest 50 jobs, including completed jobs.
- `status`, `retry`, `cancel`: `job_id`.

A job view contains `id`, `status`, `phase`, `requested_count`, `generated_count`,
`quiz_id`, `error_code`, `analyzed`, `total`, `created_at`. Internal source text,
configuration and leases are never returned. Statuses: `queued`, `processing`,
`completed`, `failed`, `cancelled`. Phases: `analyze`, `generate`.

One request UUID per user action; keep it on network retries. Different input with
the same UUID is `REQUEST_CONFLICT`. A deliberate new action creates a new quiz.
`completed` means the quiz and job completion were committed together. Clients
read `learning_quizzes`; they must not call `save_learning_quiz` again for that job.
The existing attempt RPCs and immutable revisions remain unchanged.

Generated questions contain a nonempty `explanation` (maximum 4000 characters)
and at least one source. Sources are normalized from `source_chunk_ids` by the
server: document/material/chunk IDs, title, page and excerpt. Old quizzes without
explanations or sources remain readable. `save_learning_quiz` also accepts an
optional explanation; source snapshots supplied by clients are ignored.

## Processing and limits

`quizzes-process` reuses the answer provider and summary configuration. Each step
analyzes a bounded index chunk, selects distinct learning points, or generates up
to three questions. Checkpoints survive browser closure. Structured output is
checked for types, lengths, distinct options, valid answer indices, duplicate
questions and permitted source IDs. Analysis and selection reuse the flashcard
learning-point pipeline. No quiz is published before the entire accepted set is
validated. Source IDs alone cannot prove factual correctness; review generated
claims against the displayed source.

The source snapshot includes all indexed chunks and readiness states. Changed
sources invalidate jobs. Leases fence stale workers; cancellation and source
removal prevent late completion. Worker transport/invalid-output failures retain
the last successful checkpoint and retry after lease expiration (three claims per
step). Up to three explicit retries are allowed; paid budgets never reset.
Terminal source/content/budget failures require a new action.

Limits: 500,000 source characters (also bounded by summary source configuration),
300 candidate learning points, four active jobs and ten new jobs/hour per owner.
Monthly `quizzes` quota defaults to 5 free / 50 pro, configurable via
`quizGenerationsPerMonth` in `supabase/usage-limits.mjs`. A job is charged atomically
at admission. Failed/cancelled jobs retain that unit because provider work may
already have happened. A replay/retry consumes no additional unit; there is no
chat charge. Summary model-call and token budgets apply independently.

## Deployment and rollback

Apply `20261005100000_quiz_generation.sql`, configure plan limits with the updated
scripts, and deploy `quizzes` and `quizzes-process` before the frontend. Both use
`verify_jwt=false` and validate their own authentication. The cron dispatch runs
every ten seconds, reusing the existing document worker URL/key in Vault. No new
provider secret is needed. Existing CI deploys all Edge Functions.

To stop new jobs, set both quiz quotas to zero and apply the quota configuration.
Already admitted jobs continue unless cancelled. Stored quizzes and attempts
remain accessible. Account/course/material deletion cascades to job rows; the
account export already includes quiz questions, explanations, sources, attempts
and usage. Internal job snapshots/checkpoints follow the existing exclusion of
technical processing data from exports.

## Verification

- `npm run functions:test`: pure validation and pipeline tests.
- `npm run test:quizzes`: actual authenticated handlers and local PostgreSQL,
  deterministic provider transport, concurrent admission, full worker progression,
  provenance, RLS, attempts and quota accounting; no external model calls.
- `npm run test:db`: generation SQL tests, ownership, idempotency, rollback,
  source changes, cancellation, budgets and cascade checks.
- `npm run test:learning`: isolated migration rebuild and learning concurrency tests.

Production deployment and manual evaluation with real model outputs are separate
from these deterministic checks.
