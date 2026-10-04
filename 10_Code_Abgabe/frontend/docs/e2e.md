# End-to-end tests (Playwright)

Chromium only, `@playwright/test` pinned in `package.json`. The unit/contract suite (`npm test`) is
unchanged; E2E is a small, high-signal layer on top.

## Public suite (CI)

```
npx playwright install chromium   # once
npm run test:e2e:public
```

Needs no backend. It starts `next dev` on port 3100 with an inert Supabase placeholder (your
`.env.local` is never used) and checks landing/login/register/forgot-password, the redirect of every
protected route to login, hostile `next` parameters, security headers and phone-width overflow.
CI runs exactly this command (job `E2E (public)`).

## Local authenticated suite (not run in CI)

Needs the backend's local Supabase stack with its seed (`../backend`: `npm run db:start`, seed users
`anna@example.com` etc., course "Biologie"). Then, from this repo:

```
# Values from `supabase status -o env` in ../backend (API_URL and PUBLISHABLE_KEY)
E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_PUBLISHABLE_KEY=<local key> npm run test:e2e:local
```

The config refuses any non-loopback Supabase URL, so the seed credentials cannot be used against
staging or production. It covers login, wrong password, logout and guard afterwards, `next` handling,
every main route rendering, the upload dialog's format check, and the phone-width navigation drawer.
Stop any other `next dev` for this project first (Next allows one dev server per directory).

## Deliberately not automated

Anything that needs the AI provider or the full document pipeline is manual final QA, not E2E:
real upload + processing to "Bereit", document chat, summary/flashcards/quiz, chat feedback,
processing retry, signed-URL preview/download, password recovery by e-mail, and a visual check of the
browser console for CSP violations. No fake AI responses exist in the app, and none are added for tests.

## Quiz workflow

`e2e/local/quiz.spec.ts` additionally requires `E2E_SUPABASE_SERVICE_ROLE_KEY` for
local fixture creation. The key is read only by the test runner; never use a
remote service key. The test creates and removes its own course, prepares an
indexed document, and exercises generation status, reload, persisted answers,
resumption, server scoring, result history, two-tab conflicts and quota errors.
Only the quiz job HTTP transport is simulated in Playwright; quiz storage and
attempt RPCs use the real local database. Actual generation handlers and worker
are covered by backend `npm run test:quizzes` with deterministic AI transport.
No mock behavior is included in application code. Real model quality remains a
manual content check.
