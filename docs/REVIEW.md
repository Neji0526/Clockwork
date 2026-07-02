# ClockWork — App Review

_Date: 2026-06-17_
_Scope: full app — bugs, security, code quality, UX. Read-only audit; no code changed._

Findings are grouped by severity. Each has a file:line reference, the symptom/impact, and a 1–2 line fix. Counts: **8 Critical, 12 High, 16 Medium, 8 Low** + 3 informational ✅ checks. The top‑10 list at the end is a good place to start.

---

## 🔴 Critical (data loss, security, broken core flow)

### C1 — VA "today" totals double-count active time
**`src/components/va-home.tsx:420-422`** · VA flow
`todayTotals` sums `active_sec` from `todayQ.data` and then adds `liveSec` (full wall-clock since `started_at`), so the active session is counted twice while a session is running.
**Fix:** `+= Math.max(0, liveSec - (active.active_sec ?? 0))` — only the un-synced delta.

### C2 — Invoice line-items: non-atomic delete-then-insert can wipe data
**`src/routes/admin_.invoices.$invoiceId.tsx:154-172`** · Admin/Invoices
Delete-all-then-insert with no transaction. If insert fails, all line items are permanently gone.
**Fix:** Move to a Postgres RPC that runs both inside one transaction, or upsert by id and only delete rows missing from the new list.

### C3 — Ingest endpoints don't verify `session_id` belongs to the caller
**`supabase/functions/_shared/ingest-core.ts:140,154,165,221,244`** · Edge functions
`activity`, `idle`, `engagement`, `screenshot`, `step` insert with caller-supplied `session_id` but no `.eq("va_id", vaId)` check on the parent session. A compromised VA token can taint another VA's session totals and payroll.
**Fix:** Shared helper that fetches `work_sessions.id` filtered by `va_id` and rejects mismatches.

### C4 — Admin viewing one VA pulls every VA's idle/break rows
**`src/routes/admin_.$vaId.tsx:104-107`** · Admin
`idle_segments` and `break_segments` queries lack `.eq("va_id", vaId)`. Client-side joins by `session_id` "work" but leak/aggregate other VAs' rows in the meantime.
**Fix:** Add `.eq("va_id", vaId)` to both queries.

### C5 — `auth-context` can hang on `loading=true` forever
**`src/lib/auth-context.tsx:53`** · Auth
`supabase.auth.getSession().then(...)` has no `.catch` / `.finally`. A network blip on first load leaves the app stuck on the global "Loading…" splash.
**Fix:** Wrap in `.finally(() => setLoading(false))`.

### C6 — `/reset-password` lets any signed-in user set a new password
**`src/routes/reset-password.tsx:31`** · Auth
`onAuthStateChange` treats `SIGNED_IN` (not only `PASSWORD_RECOVERY`) as a valid recovery context. Any logged-in user who navigates to `/reset-password` can set a new password without an emailed link — circumvents 2FA/email-loop for password resets.
**Fix:** Gate `setReady(true)` on `evt === "PASSWORD_RECOVERY"`; keep the `getSession` branch as the second path for direct recovery-link arrival.

### C7 — `createSopFromSignature` builds an SOP from the wrong steps
**`src/lib/sops.functions.ts:119-124`** · SOPs
Fetches the VA's last 50 `workflow_steps` with no link to the signature's session/window. The generated SOP reflects whatever the VA most recently did, not the workflow that was signed.
**Fix:** `.eq("session_id", sig.session_id)` (or filter by the signature's timestamp window).

### C8 — Admin invite list returns plaintext tokens
**`src/lib/admin-invites.functions.ts:67`** · Security
`listAdminInvites` selects `token` — the secret that grants admin — on every list call. Visible in admin UI, devtools, and network logs.
**Fix:** Store a hash + first-8-chars preview, return the raw token only once at creation (mirror `mintDeviceToken`).

---

## 🟠 High (broken secondary flow, real UX/security blocker)

### H1 — Realtime channel subscriptions are not scoped to the user
**Security scanner / `realtime.messages`**
No RLS on `realtime.messages`, so any authenticated VA can subscribe to any channel including other VAs' `work_sessions`, `screenshots`, `activity_events`, etc.
**Fix:** Add RLS on `realtime.messages` scoping topics by `auth.uid()` (Supabase Realtime Authorization).

### H2 — `admin-invite` edge function returns `temp_password` in the response body
**`supabase/functions/admin-invite/index.ts:151`** · Security
Cleartext password in the response payload — captured in any body logging, browser network panel, or telemetry.
**Fix:** Email the credentials directly, or use Supabase's invite flow with first-login forced reset. Confirm Edge Function logs don't capture bodies in prod.

### H3 — Wildcard CORS on privileged edge function
**`supabase/functions/admin-invite/index.ts:6`** · Security
`Access-Control-Allow-Origin: "*"` on a route that creates VAs and returns a password.
**Fix:** Restrict to your app's origins explicitly.

### H4 — VA profile RLS allows column-level escalation if trigger lapses
**Security scan · `profiles` "self update" policy**
Only checks `user_id = auth.uid()`; relies on the privileged-fields trigger to prevent `role`/`status`/`pay_*` writes.
**Fix:** Add `WITH CHECK (role = 'va' AND status = 'active' AND … pay fields unchanged)` to the policy itself.

### H5 — `app_config` exposes billing info to every authenticated user
**Security scan · `app_config` policy**
VAs can SELECT `billing_email`, `billing_address`, `billing_business_name`, `billing_payment_notes`, `billing_logo_url`.
**Fix:** Restrict SELECT on `app_config` to admins; expose a view of operational columns (`session_timeout_minutes`, `idle_threshold_sec`) to VAs.

### H6 — `auth-context` race: profile load + `loading` state
**`src/lib/auth-context.tsx:42-61`** · Auth
`onAuthStateChange` may fire before `getSession()` resolves and defers `loadProfile` via `setTimeout(…, 0)` without ever calling `setLoading(false)`. Re-mounts during this window spin forever.
**Fix:** Call `loadProfile` directly; mirror the `loading` reset done in `getSession`.

### H7 — VA home auto-pause `useEffect` has stale-closure suppression
**`src/components/va-home.tsx:319-330`** · VA flow
`// eslint-disable-next-line` hides that `startBreak` captures stale `active`/`openBreak`.
**Fix:** Include `startBreak` in deps (memoize it) or read fresh state via refs.

### H8 — SOP detail keeps stale snapshot after save
**`src/routes/sops.index.tsx:344-373`** · SOPs
`openSop` retains the pre-edit snapshot, so the dialog reverts to old title/description until reopened.
**Fix:** Update `openSop` from the saved row on success, or close the dialog.

### H9 — Long-idle alert duplicates VAs already on a break
**`src/components/notifications-bell.tsx:85-107`** · UX
A VA correctly on a long break is also shown in long-idle alerts.
**Fix:** Exclude sessions with an open `break_segments` row.

### H10 — Admin TodayPanel: N+4 query fan-out on a 15s interval
**`src/routes/admin.tsx:280-328`** · Perf
~40+ Supabase round-trips per refresh for 10 VAs. Repeated in **LivePanel** at `:721` too.
**Fix:** Add `admin_today_summary()` RPC that joins server-side; until then, batch lookups with `session_id IN (...)`.

### H11 — Stale midnight-bounds `useMemo` in admin/productivity hook
**`src/routes/admin.tsx:252-253`** and **`src/hooks/use-productivity.ts:23-24`** · Bug
`useMemo(fn, [])` freezes today's start/end at mount. A tab left open past midnight keeps fetching yesterday.
**Fix:** Compute bounds inside `queryFn`, or add a midnight-aware tick.

### H12 — `useRealtimeInvalidate` missing `qc` dep
**`src/hooks/use-realtime-invalidate.ts:34-62`** · Bug
`QueryClient` captured outside deps; in any env where the client instance changes, invalidations silently no-op.
**Fix:** Add `qc` to deps.

---

## 🟡 Medium

### M1 — `auth.tsx` double-navigation race
**`src/routes/auth.tsx:60`** · Auth
Both the explicit `navigate()` after `signInWithPassword` and the `useEffect` on `user` redirect — double push under StrictMode/slow networks. **Fix:** keep the effect, drop the explicit call.

### M2 — `auth.tsx` shares password state across tabs
**`src/routes/auth.tsx:64-78`** · UX
Sign-in tab pre-fills sign-up password and vice-versa. **Fix:** separate state per tab, or clear on tab change.

### M3 — Activity-log dedup is sort-order dependent
**`src/components/va-activity-log.tsx:113-126`** · Bug
Dedup of consecutive same-URL visits only works in desc; asc view shows duplicates. **Fix:** dedup after final sort.

### M4 — Capture-now: realtime callback acts on intermediate states
**`src/components/capture-now-button.tsx:89-95`** · Bug
`resolveAndOpen` fires on every `UPDATE`; only act on terminal `status` ("fulfilled"/"failed"). **Fix:** early-return guard in the channel callback.

### M5 — Admin-invite redirect timeout not cleared on unmount
**`src/routes/admin-invite.$token.tsx:82`** · Bug
`setTimeout(..., 1200)` may fire after the user navigated elsewhere, forcing them to `/admin`. **Fix:** capture id, clear in cleanup.

### M6 — SOP playback auto-advance restarts on every step change
**`src/routes/sops.$sopId.tsx:131-145`** · UX
Interval recreated whenever `i` changes; clicking "Next" while auto-play is on causes a fresh 7s pause. **Fix:** use a `startRef` instead of recreating the interval.

### M7 — Consent: two-write flow can leave inconsistent state
**`src/routes/consent.tsx:36-53`** · Bug
Insert `consent_records` succeeds, profile update fails → loop back to `/consent`; re-click duplicates the insert. **Fix:** `upsert(..., { onConflict: "user_id" })` or single RPC.

### M8 — Auth-context loads profile twice on first mount
**`src/lib/auth-context.tsx:40-61`** · Perf
Listener and `getSession` both `loadProfile` — second wins, first round-trip wasted. **Fix:** dedupe.

### M9 — Public-share "Today" bar is computed by array index
**`src/routes/c.$token.tsx:127`** · Bug
Wrong day highlighted when client TZ trails UTC. **Fix:** server returns `isToday` per row, or compare `d.date` to local date.

### M10 — Admin invite token preview/accept have no rate-limit
**`src/lib/admin-invites.functions.ts:97,115`** · Security
Authenticated users can probe tokens / loop accept attempts.
**Fix:** Per-user rate-limit (mirror `auth.functions.ts:checkRate`); log failed probes.

### M11 — Ingest accepts arbitrary `started_at` (backdating)
**`supabase/functions/_shared/ingest-core.ts:146,158,200`** · Security
A compromised token can backdate or future-date events inflating payroll.
**Fix:** Clamp `started_at` to `[now - 7d, now + 60s]`.

### M12 — Cleanup webhook does DB round-trip before fast-rejecting empty header
**`src/routes/api/public/hooks/cleanup-screenshots.ts:13`** · Security
DoS vector: hits `internal_secrets` before checking the header is even present.
**Fix:** `if (!provided) return 401` before importing `supabaseAdmin`.

### M13 — `adjustSession` audit log omits `va_id`
**`src/lib/admin.functions.ts:166`** · Security/Audit
No `va_id` recorded → forensic gap. **Fix:** select `va_id` first, include in `admin_actions.metadata`.

### M14 — Dialog accessibility: missing `DialogDescription`
**`src/routes/admin.tsx:1665, 2333, 2557, 3710`** · a11y
Radix UI warns; screen readers lack context. **Fix:** add visually-hidden `DialogDescription` to each.

### M15 — All Tabs panels render simultaneously
**`src/routes/admin.tsx:114-155`** · Perf
~3000 lines of JSX reconcile on every tab switch. **Fix:** gate panels with `{tab === "live" && <LivePanel />}`.

### M16 — LivePanel re-renders 3000 lines every 1s
**`src/routes/admin.tsx:696`** · Perf
`setNow` tick re-renders the entire panel including memos. **Fix:** isolate the clock into a leaf `<Elapsed />` component.

---

## 🔵 Low / Polish

### L1 — `getClientShareView` over-selects `client_id`
`src/lib/client-share.functions.ts:101` — fetched then dropped. Prune projection.

### L2 — Client-share token validators have no `.max()`
`src/lib/client-share.functions.ts:60,81` — unbounded string to DB index. Add `.max(64)`.

### L3 — Leaderboard returns raw VA UUIDs to all VAs
`src/lib/leaderboard.functions.ts:79` — enumeration surface. Strip `userId` from non-self rows.

### L4 — Agent-ingest rate limit in-memory only
`supabase/functions/agent-ingest/index.ts:33` — resets on cold start. Back with `rate_limits` table.

### L5 — Admin-invite token stashed in `sessionStorage` not cleared on failure
`src/routes/admin-invite.$token.tsx:43` — clear in `finally` + `beforeunload`.

### L6 — `extension-version` OPTIONS echoes `Allow-Headers: "*"`
`src/routes/api/public/extension-version.ts:28` — restrict to `Content-Type`.

### L7 — Admin route head() has no `noindex`
`src/routes/admin.tsx:44` — add `{ name: "robots", content: "noindex,nofollow" }`.

### L8 — Skeleton lists missing `key` on map
`src/components/ui/skeletons.tsx` — add `key={i}`.

---

## ✅ Verified safe (informational)

- **`supabaseAdmin` imports**: every `*.functions.ts` uses in-handler `await import(...)`. No client-bundle leak.
- **`LOVABLE_API_KEY`**: only read inside handlers behind `assertAdmin` (`src/lib/sops.functions.ts:39,136`).
- **Browser supabase client**: SSR fallback only reads publishable keys, never `SERVICE_ROLE`.

---

## Appendix A — Inventory

**Routes (18)**: `__root`, `index`, `auth`, `consent`, `reset-password`, `admin`, `admin_.$vaId`, `admin_.invoices.$invoiceId`, `admin-invite.$token`, `c.$token`, `sops.index`, `sops.$sopId`, `guide.index`, `guide.admin`, `install`, `settings`, `api/public/extension-version`, `api/public/hooks/cleanup-screenshots`.

**Server functions** (`src/lib/*.functions.ts`): `admin`, `admin-invites`, `auth`, `client-share`, `device-tokens`, `leaderboard`, `sops`, `api/example`.

**Edge functions**: `admin-invite` (JWT-verified), `track-ingest` (JWT-verified), `agent-ingest` (token-verified).

**Database**: 30 tables (see schema), 11 functions (`has_role`, `handle_new_user`, `guard_profile_privileged_*`, `bump_session_heartbeat`, `admin_list_clients_with_billing`, `admin_get_billing_config`, `flag_sop_needs_review`, `touch_updated_at`, `next_invoice_number`, `close_stale_sessions`), no triggers listed.

**Storage**: 1 bucket — `va-screenshots` (private).

**Integrations**: Lovable Cloud (Supabase) for auth + DB + storage + edge functions; Lovable AI Gateway via `LOVABLE_API_KEY` for SOP generation; custom domain `clockwork.aiforbusiness.com`.

**Secrets (names only)**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS`, `SUPABASE_DB_URL`, `LOVABLE_API_KEY`.

---

## Appendix B — Suggested next-actions (top 10)

1. **C5** — finally-block on `getSession` (5 min).
2. **C6** — gate `/reset-password` on `PASSWORD_RECOVERY` only (5 min).
3. **C4** — add `va_id` filter to admin per-VA queries (10 min).
4. **C1** — fix VA today double-count (10 min).
5. **C3** — `session_id` ownership check in ingest core (30 min, shared helper).
6. **C8** — hash-and-preview admin invite tokens (1 h + tiny migration).
7. **H2/H3** — stop returning `temp_password`; lock CORS on `admin-invite` (30 min).
8. **H1** — RLS on `realtime.messages` scoping by user (1 h).
9. **H5** — restrict `app_config` SELECT to admin; expose VA-safe view (30 min).
10. **C2** — atomic invoice line-items upsert RPC (1 h).

Then tackle perf (H10/H11/M15/M16) and the SOP/notifications bugs (C7/H8/H9). Splitting `src/routes/admin.tsx` (~3.9k lines) into panel files makes everything after that cheaper.
