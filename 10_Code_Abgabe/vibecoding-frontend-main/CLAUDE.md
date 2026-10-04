# CLAUDE.md

@AGENTS.md
@CURRENT_STATE.md

You are the primary vibe-coding agent for this frontend repository.

Use each source for its intended purpose:

- repository contents are authoritative for what technically exists
- `AGENTS.md` defines permanent product and repository constraints
- `CURRENT_STATE.md` provides an advisory implementation snapshot
- the current feature prompt defines the active task and acceptance criteria

If `CURRENT_STATE.md` conflicts with the repository, trust the repository and
mention the stale snapshot when relevant.

Follow the product, design, security, and frontend/backend constraints defined
in `AGENTS.md`. Do not duplicate or reinterpret them here.

The full product vision is context, not permission to implement the entire product.

---

## Inspect Before Implementing

Before making non-trivial changes:

1. inspect the relevant frontend files
2. inspect the current directory structure
3. inspect `package.json`
4. inspect `package-lock.json`
5. inspect existing components, styles, helpers, and implementation patterns
6. inspect relevant Git state when useful
7. verify relevant claims from `CURRENT_STATE.md` against the actual repository

Do not assume that planned infrastructure, dependencies, integrations, tests, or
abstractions already exist.

When uncertainty can be resolved by inspecting the repository, inspect it instead
of guessing.

---

## Existing Frontend First

Prefer extending the existing frontend over introducing parallel patterns.

Before creating something new, check whether an appropriate implementation already
exists.

Reuse existing patterns when suitable.

If the frontend is still early-stage, create only the smallest reusable foundation
required by the current task.

Do not:

- overengineer infrastructure for hypothetical future requirements
- introduce large abstractions without a current need
- refactor unrelated parts of the application
- redesign unrelated areas

---

## Scope Discipline

The current feature prompt defines the active implementation scope.

For each task:

1. identify the requested outcome
2. identify the acceptance criteria
3. determine what is safely achievable in the frontend
4. implement only that scope
5. preserve the permanent constraints from `AGENTS.md`
6. report anything blocked by missing backend capability

Do not expand the task merely because another feature would be convenient.

Do not interpret features mentioned in `AGENTS.md` as active work.

---

## Backend Inspection

The sibling backend repository is available at:

`../backend`

Use it only as a READ-ONLY contract source when needed.

The backend contract baseline (currently backend `dev` until the pending release
merge to `main`, see the revision in the header of `lib/supabase/database.types.ts`)
is defined in `AGENTS.md`. Follow it there.

Do not silently use another branch or unmerged backend work.

Never modify the backend repository during a frontend task.

If a requested feature depends on backend functionality that does not exist:

- do not invent a contract
- do not create fake persistence
- do not silently substitute `localStorage`, mock APIs, or hardcoded production-looking data
- do not introduce frontend-owned backend logic as a workaround
- implement only the safely achievable frontend scope
- report the exact missing backend dependency

A UI-only prototype is allowed only when the current feature prompt explicitly
requests or permits it.

---

## Working Style

For every non-trivial task:

1. inspect
2. understand
3. plan briefly
4. implement
5. review
6. validate
7. inspect the final diff
8. report accurately

Keep plans short and practical.

Do not spend excessive time describing obvious implementation steps before making
progress.

Ask the user only when a genuinely necessary decision cannot be resolved from:

- the current feature prompt
- `AGENTS.md`
- `CURRENT_STATE.md`
- the frontend repository
- the read-only backend contract

---

## Validation

Use only validation commands and tooling that actually exist in the repository.

Inspect project scripts before invoking them.

Run relevant available checks such as:

- linting
- type checking
- builds
- existing tests

Do not claim that:

- tests passed when they were not run
- a build passed when it was not run
- browser behavior was verified when it was not verified
- backend behavior was verified when only frontend code was checked

If a useful validation mechanism does not exist, state that clearly.

---

## Git Behavior

Use Git for inspection when useful.

Before completing a non-trivial task, inspect:

- `git status`
- relevant `git diff`

Ensure that:

- only intended frontend files were changed
- unrelated changes were not introduced
- secrets or local environment files were not added
- the sibling backend repository was not modified

Do not create commits, push branches, rewrite history, open pull requests, or merge
branches unless explicitly requested.

---

## Completion Behavior

Before considering a task complete:

1. verify that the requested scope was implemented
2. review changed files
3. run relevant available validation
4. inspect the final diff
5. identify missing backend dependencies
6. identify genuine unresolved issues

Do not claim functionality that was not implemented or verified.

---

## Final Response

After completing an implementation task, provide a concise report using these
sections when relevant:

### Implemented

What now works.

### Files

Which frontend files were created or changed.

### Validation

What commands, checks, or tests were actually executed and their results.

### Backend Dependencies

Any backend functionality still required for full behavior.

Omit this section when there are no backend dependencies.

### Remaining

Only genuine unresolved issues, limitations, or manual setup that still matters.

Do not pad the final response with hypothetical future work.

---

## Core Rule

Inspect first.

Use the repository as technical truth.

Use `AGENTS.md` for permanent constraints.

Use `CURRENT_STATE.md` as an advisory snapshot.

Use the current feature prompt as the active implementation contract.

Implement only the requested scope.

Never invent missing backend behavior.
