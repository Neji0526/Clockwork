# Full App Review — ClockWork

## Goal
Produce one prioritized report at `docs/REVIEW.md` covering bugs, security, code quality, and UX, with file:line references so we can triage together.

## Approach

I'll review the app across five axes in parallel (using read-only sub-agents where useful), then consolidate into a single doc.

### 1. Bugs & broken flows (primary focus)
Trace each high-traffic flow end-to-end, looking for runtime errors, race conditions, missing error states, and data-shape mismatches:
- Auth: sign up / sign in / Google OAuth / reset password / consent gate
- VA flow: My Day → start session → activity capture → break → end → screenshots
- Admin flow: team list, VA detail, timesheets, approvals, invoices (create, line items, mark paid), client share links
- SOPs: list, detail, walkthrough, comments, share, completion
- Install / extension pairing / device tokens
- Notifications bell, command palette, shortcuts overlay
- Realtime invalidation hooks
- Empty / loading / error states on every route with a loader

### 2. Security & RLS audit
- Run `security--run_security_scan` and `security--get_table_schema`
- For every table: confirm RLS enabled, GRANTs present, policies scoped to `auth.uid()` or `has_role`
- Server functions: verify every privileged fn calls `assertAdmin` / role check before `supabaseAdmin`
- Check no `supabaseAdmin` import at module scope of `*.functions.ts`
- Edge functions (`admin-invite`, `track-ingest`, `agent-ingest`): auth, signature/secret verification, input validation
- Client-share / SOP-share token routes: token validation, expiry, scope
- Secrets: confirm none leaked in client bundle; list referenced secret names

### 3. Database & schema
- Review the 30 tables + functions + triggers for: missing indexes on hot query paths, FK cascade correctness, nullable columns that shouldn't be, enum drift
- Check `close_stale_sessions` cron wiring
- Storage bucket `va-screenshots`: policies, cleanup job at `/api/public/hooks/cleanup-screenshots`

### 4. Code quality & architecture
- Dead code, duplicated logic, oversized files (esp. `src/routes/admin.tsx`)
- Type safety: `any` usage, unchecked casts
- React: stale-closure bugs in effects, missing deps, key warnings, unmounted-setState
- Performance: unnecessary re-renders, large query payloads, missing memoization on hot paths
- Bundle: accidental server imports leaking client-side
- Consistency with project conventions (server fn layout, Supabase client choice)

### 5. UX & polish
- Recent mobile-responsive pass — verify nothing regressed on desktop
- Empty states, loading skeletons, error boundaries
- Accessibility: focus management in dialogs/drawer, alt text, semantic headings, keyboard nav (⌘K, ?, G-leader)
- SEO metadata on public-facing routes (`/`, `/c/$token`, `/sops/$sopId` share view)

## Deliverable

Single file `docs/REVIEW.md` with this structure:

```
# ClockWork — App Review (2026-06-17)

## Critical   (data loss, security, broken core flow)
## High       (broken secondary flow, real UX blocker)
## Medium     (rough edges, perf, code-quality risk)
## Low        (polish, nits)
## Notable strengths

Each finding:
- **Title** — one-line summary
- Severity, area (Auth / VA / Admin / SOPs / DB / Infra / UX)
- Files: `src/routes/admin.tsx:L420-L460`
- Symptom / Impact
- Suggested fix (1–3 lines)
```

Plus an appendix:
- Inventory: routes, server fns, edge fns, tables, secrets (names only), storage buckets, integrations (auth providers, AI gateway, custom domain)
- Suggested next-actions checklist (top 10 to tackle first)

## Out of scope

- No code changes in this pass — review only
- No credential values, only names
- No exhaustive line-by-line dump of source (that's what the repo is for); findings reference file:line instead

## After you approve

I'll execute the review and write `docs/REVIEW.md`. Expect ~30–60 findings. We can then triage together and I'll fix in priority order in follow-up turns.
