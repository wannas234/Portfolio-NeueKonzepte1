# AGENTS.md

## Project

This repository contains the frontend of a web-first intelligent study and lecture assistant for university students.

The product connects study organization with lecture-based learning in one continuous workflow:

Course\
→ Lecture\
→ Document / Slide\
→ Personal Annotation\
→ Dates / Calendar\
→ Summary\
→ Flashcards\
→ Exam Preparation

The product must not become a generic PDF chatbot or a collection of isolated AI features.

Its differentiation is the connected workflow between study organization, lecture context and exam preparation.

The overall goal is to reduce manual context transfer between lecture material, study organization and later learning.

---

## Target Users

Primary target group:

- university students
- Bachelor students
- Master students

Initial product hypothesis:

Students in content-heavy and exam-intensive degree programs may benefit especially from the product.

This is a product hypothesis, not a proven fact.

---

## Repository Responsibility

This repository is FRONTEND ONLY.

It owns frontend concerns such as:

- pages
- layouts
- components
- forms
- navigation
- frontend state
- user interactions
- responsive behavior
- accessibility
- loading states
- empty states
- error states
- displaying backend data
- consuming already available backend or Supabase interfaces
- representing long-running processing states in the UI

It does NOT own:

- database schema
- database migrations
- Row Level Security policy definitions
- Supabase backend configuration
- database functions
- background workers
- queues
- server-side AI processing infrastructure
- payment backend
- backend entitlement logic
- backend usage-limit infrastructure
- new product-domain backend APIs
- backend business logic

Do not use Next.js server-side mechanisms as a substitute for missing backend capabilities.

Server Components, middleware, or other framework features may be used for frontend/web-application concerns such as rendering, navigation, or session-aware UI when appropriate, but they must not silently become a second product backend.

---

## Sibling Backend Repository

A separate backend Git repository exists as a sibling directory:

`../backend`

The backend repository may be inspected READ-ONLY when necessary to understand the current contract, including:

- Supabase schema
- migrations
- generated database types
- authentication behavior
- Row Level Security behavior
- Edge Functions
- Storage configuration
- existing backend capabilities

Never modify files in `../backend` during a frontend task.

Do not:

- create or edit backend migrations
- create or edit RLS policies
- modify Edge Functions
- modify generated backend types
- change Supabase configuration
- switch backend branches
- create backend commits
- push backend changes

Backend contract baseline:

- Feature exception authorized for `feat/ai-quiz-generation`: use the paired backend feature branch and migration `20261005100000_quiz_generation.sql`. Deploy its migration and functions before this frontend; update the types header to the final backend commit.

- Until the pending backend release merge `dev` → `main`, the backend `dev` branch at the revision recorded in the header of `lib/supabase/database.types.ts` is the integration baseline of this frontend. Backend `main` does not yet contain the features the frontend depends on (RLS, files, chat, calendar, grades), so it is not the complete contract.
- After the release merge, backend `main` is the production contract again. Then update this section and re-sync `lib/supabase/database.types.ts` from `main`.
- The baseline is a deliberate, documented state, not a permanent rule. Do not switch to another branch, an unmerged feature branch, or a different revision without an explicit instruction.
- `lib/supabase/database.types.ts` is a verbatim copy of `../backend/types/database.types.ts`. Re-sync it as a whole when the baseline changes; never patch it by hand.
- If frontend and backend disagree, report the drift instead of adapting the frontend to unmerged backend work.

If a requested frontend feature requires backend functionality that does not exist on the current backend contract:

1. do not invent a backend interface
2. do not create a fake production backend
3. do not redesign the database from this repository
4. do not work around missing RLS or schema behavior
5. implement only the safely achievable frontend scope
6. report the exact backend dependency

A missing backend capability does not automatically authorize a UI-only substitute.

Build a UI-only prototype only when the current feature prompt explicitly requests or permits it.

Do not silently use `localStorage`, in-memory state, mock APIs, or other fake persistence as a substitute for missing production persistence.

---

## Product Goal

A student should eventually be able to:

1. register and log in
2. access a protected application area
3. create and manage courses
4. upload lecture material to a course
5. view lecture material slide by slide or page by page
6. attach personal notes and markings to specific slides
7. see extracted topics, definitions, dates and other relevant information
8. review detected dates before they become calendar entries
9. revisit unresolved lecture notes
10. generate explanations and examples
11. generate summaries
12. generate flashcards
13. manage basic academic performance information
14. prepare for an exam using accumulated course and lecture context

The frontend should preserve course, lecture, document and slide context whenever relevant.

---

## Core Product Areas

### Authentication

The product requires:

- registration
- login
- persistent authenticated sessions
- logout
- protected application areas

The backend provides Supabase Auth.

The corresponding frontend integration may not exist yet.

Verify `CURRENT_STATE.md` and the repository contents before implementation.

Do not implement custom password storage or custom authentication logic.

### Dashboard

The dashboard should give the student a useful overview of items such as:

- courses
- upcoming deadlines
- exams
- recent lecture material
- unresolved notes
- relevant learning progress

The dashboard should prioritize useful context instead of becoming an overloaded analytics screen.

### Course Management

A course can conceptually contain:

- course name
- lecturer
- semester
- lectures
- exercises
- exams
- deadlines
- grades
- documents
- personal notes
- summaries
- flashcards

These are conceptual product entities.

Do not infer exact backend table names, field names, relationships, or API contracts from this list.

### Lecture Material

The product uses lecture documents as contextual learning material.

Important conceptual relationship:

Course\
→ Lecture\
→ Document\
→ Slide

A slide or page is a meaningful context unit in the user experience.

### Slide Annotations

Students should be able to attach information to a specific slide, for example:

- personal note
- important
- exam relevant
- explain again
- example needed
- follow up later

These annotations should remain connected to the underlying slide and later learning workflow.

### Intelligent Date Detection

Lecture material may contain dates such as:

- exams
- presentations
- assignments
- deadlines

Detected dates are suggestions, not automatically confirmed user data.

Expected UX:

Detected date\
→ show source and context\
→ user reviews\
→ user confirms\
→ calendar entry appears

### Calendar

The calendar conceptually contains:

- lectures
- exercises
- exams
- assignments
- presentations
- learning sessions
- confirmed dates extracted from lecture material

### Grade Management

The product concept includes:

- recorded grades
- achieved points
- weighting
- current overall grade
- target-grade calculations

This feature may be implemented incrementally.

### AI-Assisted Learning

The final product LLM provider is intentionally undecided.

Potential providers:

- OpenAI
- Google Gemini
- xAI Grok

Do not tightly couple frontend behavior or branding to one provider unless the current task explicitly requires it.

AI-assisted product capabilities may include:

- document analysis
- explanations
- definitions
- examples
- summaries
- flashcards
- extraction of dates
- extraction of other structured information

AI output should be presented as generated, extracted, or suggested information where appropriate.

---

## Processing States

Some operations will not complete immediately.

The frontend must be able to represent states such as:

- idle
- queued
- processing
- completed
- failed

Examples include:

- document analysis
- summary generation
- flashcard generation

The frontend must not assume that generated results always appear instantly.

The implementation of workers, queues, and background processing belongs to the backend repository.

---

## MVP Priorities

### Core MVP / MUST

- registration and login
- protected application area
- course management
- lecture material upload UI
- slide/page-based document experience
- slide-linked personal notes and markings
- display of extracted lecture information
- display and confirmation of detected dates
- course calendar
- AI-generated summaries
- AI-generated flashcards
- frontend behavior that accurately reflects backend authentication and authorization guarantees

### SHOULD

Implement when explicitly requested after or alongside the relevant core flow:

- AI explanations
- terminology explanations
- examples
- unresolved-note follow-up
- basic grade management
- target-grade calculations

### Out of Scope for the Initial MVP

- native iOS application
- native Android application
- LMS integrations
- university-wide B2B administration
- institutional licensing management
- complex collaboration
- community functionality
- full payment system unless explicitly requested

---

## Frontend Technology Context

The intended frontend stack is:

- Next.js
- React
- TypeScript / TSX
- HTML5
- Tailwind CSS

Development environment:

- Visual Studio Code
- Git
- GitHub

Planned frontend quality tools:

- ESLint
- Playwright

Deployment target:

- Vercel

Backend and infrastructure are maintained separately and currently use Supabase.

Before implementation, inspect:

- `package.json`
- `package-lock.json`

The repository files are the source of truth for installed dependency versions.

Use APIs and patterns compatible with the versions actually installed.

Do not downgrade or replace framework versions unless explicitly requested.

---

## Design Direction

The application should feel like a modern, calm and trustworthy EdTech/SaaS product.

Priorities:

- clarity
- readability
- strong visual hierarchy
- simple navigation
- calm visual language
- responsive layouts
- accessible forms
- keyboard usability
- visible focus states
- useful loading states
- useful empty states
- understandable error states
- consistent spacing
- consistent components

Avoid:

- excessive gradients
- stereotypical AI visuals
- unnecessary animation
- visually noisy dashboards
- excessive cards without hierarchy
- inconsistent spacing
- inconsistent components
- decorative UI that makes the study workflow harder to understand

The application should feel like one coherent study environment rather than a collection of unrelated tools.

---

## UX Context Principle

The user should be able to understand, whenever relevant:

- which course they are in
- which lecture they are viewing
- which document is active
- which slide an annotation belongs to
- where generated information came from
- whether information was detected, generated, confirmed, or authored by the user

Preserve context throughout the interface.

---

## Product Differentiation

Existing products already provide individual capabilities such as:

- document uploads
- AI summaries
- flashcards
- AI tutors
- learning plans
- study calendars

Therefore the product must not be positioned or designed around one isolated AI capability.

The planned differentiation is the combination of:

- course context
- specific lecture context
- slide-level annotations
- detected deadlines
- calendar
- academic performance
- AI-generated learning material
- exam preparation

within one connected workflow.

---

## Conceptual Domain Model

The frontend may consume data representing concepts such as:

- User
- Profile
- Course
- Lecture
- Document
- Slide
- Annotation
- CalendarEvent
- Grade
- Summary
- Flashcard
- ProcessingJob

These are conceptual domain entities.

Do not assume exact database table names, column names, relationships, API routes, or payload shapes unless they already exist in the frontend repository or are explicitly supported by the current backend contract.

---

## Security Context

Security is part of the product.

From the frontend perspective:

- never expose secrets
- never expose Supabase service-role credentials
- never hardcode API keys
- never store passwords manually
- use backend-provided Supabase Auth through the project's supported frontend integration
- do not create custom authentication or password-storage mechanisms
- treat uploaded documents as untrusted input
- treat AI output as untrusted generated data
- do not bypass backend authorization
- do not rely on frontend filtering as an authorization boundary
- do not invent elevated backend access to make a frontend feature work
- do not claim a backend authorization guarantee that the current backend contract does not provide

Database security, RLS policy definitions, backend authorization enforcement, sensitive business rules, and infrastructure belong to the backend repository.

---

## Source of Truth and Scope

This file describes permanent project and repository context.

It is not an instruction to implement the entire product.

The current feature prompt defines the active implementation scope and acceptance criteria.

When a task prompt defines a narrower scope:

1. follow that scope
2. preserve the permanent project context defined here
3. do not expand the task merely because other features appear in this file

`CURRENT_STATE.md` provides an advisory implementation snapshot.

It may be outdated and never overrides repository contents.

Repository contents remain authoritative.

---

## Decision Rule

When implementing a requested frontend feature:

1. inspect the existing frontend
2. preserve the project context defined here
3. follow the current task-specific prompt
4. reuse existing frontend patterns where available
5. stay inside the frontend repository boundary
6. inspect `../backend` read-only only when needed to understand an existing contract
7. do not invent backend behavior
8. do not invent database fields, API routes, or persistence behavior
9. do not use fake persistence unless explicitly permitted by the task
10. report missing backend dependencies clearly

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
