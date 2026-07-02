# Agent Ingest Contract

This is the spec for the **native desktop agent** (Tauri / Electron / Swift / .NET) that records VA work on macOS, Windows, and Linux. The web Chrome extension uses a parallel endpoint (`track-ingest`) that authenticates with a Supabase user session; the desktop agent uses **device tokens** instead.

Both endpoints share the same event-handling code (`supabase/functions/_shared/ingest-core.ts`) so payload shapes and DB side effects are identical — only the auth and the `source` / `platform` tags differ.

---

## 1. Endpoint

```
POST https://johibfayobgerhzjbisu.supabase.co/functions/v1/agent-ingest
Content-Type: application/json
Authorization: Bearer <DEVICE_TOKEN>
```

`DEVICE_TOKEN` is the plaintext shown **once** in the admin UI (Admin → VA detail → **Connected devices** → **Register a device**). The server stores only its SHA-256 hash; if lost, revoke and mint a new one.

Responses are JSON. `2xx` = stored, `401` = bad/revoked token, `403` = VA account disabled, `429` = rate limited (600 events/min/token), `400` = bad payload.

---

## 2. Event envelope

Every request body has `{ "kind": "...", ... }`. Tag every event you produce with `source: "desktop"` (the server overrides anyway, but be explicit) — the `platform` column is set automatically from the device token's platform.

### `session_start`
Begin a work session. The response gives you the `session_id` to attach to subsequent events.
```json
{ "kind": "session_start", "client_id": "OPTIONAL_CLIENT_UUID" }
→ { "session_id": "uuid" }
```

### `session_end`
Close a session. Server rolls up active/idle seconds.
```json
{ "kind": "session_end", "session_id": "uuid" }
→ { "ok": true, "active_sec": 1234, "idle_sec": 56 }
```

### `heartbeat`
Touch the session so it isn't auto-closed as stale. Send every ~60s while the agent is running, even when the user is idle.
```json
{ "kind": "heartbeat", "session_id": "uuid" }
```

### `activity`
A focused-window stretch. For native apps, `url` is `null` — just pass the app + window title.
```json
{
  "kind": "activity",
  "session_id": "uuid",
  "app": "Visual Studio Code",
  "title": "agent-ingest/index.ts — clockwork",
  "url": null,
  "started_at": "2026-06-17T12:34:56.000Z",
  "duration_sec": 42
}
```

### `idle`
A detected idle stretch (no input for N seconds, threshold per workspace).
```json
{
  "kind": "idle",
  "session_id": "uuid",
  "started_at": "2026-06-17T12:34:56.000Z",
  "duration_sec": 300
}
```

### `engagement`
Per-window interaction counts. **Counts only — never keystroke values or text content.**
```json
{
  "kind": "engagement",
  "session_id": "uuid",
  "window_sec": 60,
  "interacted": true,
  "click_count": 12,
  "key_count": 80,
  "scroll_count": 4
}
```

### `screenshot`
Full-screen JPEG/PNG, base64 data-URL encoded. Server uploads to the `va-screenshots` bucket and writes a `screenshots` row.
```json
{
  "kind": "screenshot",
  "session_id": "uuid",
  "data_url": "data:image/jpeg;base64,...",
  "capture_request_id": "OPTIONAL_capture_requests.id"
}
→ { "ok": true, "path": "<va>/<session>/<ts>.jpg", "screenshot_id": "uuid" }
```

### `step`
A workflow step (click). The server normalizes a rolling signature and auto-generates an SOP once a sequence repeats 10×.
```json
{
  "kind": "step",
  "session_id": "uuid",
  "step_index": 3,
  "label": "Save",
  "tag": "button",
  "url": null,
  "rect": { "x": 100, "y": 200, "w": 80, "h": 28 },
  "dpr": 2,
  "viewport": { "w": 1920, "h": 1080 },
  "screenshot": "data:image/jpeg;base64,...",
  "workflow_end": true,
  "workflow_labels": ["Open ticket", "Reply", "Save"]
}
```

### `break_start` / `break_end`
```json
{ "kind": "break_start", "session_id": "uuid", "reason": "Lunch" }
{ "kind": "break_end" }
```

---

## 3. Source / platform tagging

The server stamps each row with:
- `source = "desktop"`
- `platform = "macos" | "windows" | "linux"` (from the device token)

The Chrome extension writes `source = "extension"`, `platform = "chrome"`. Dashboards use this to render a Browser / Desktop chip and filter the activity log.

---

## 4. Token lifecycle

Admins mint and revoke device tokens at **Admin → VA detail → Connected devices**. The token is shown once at creation and stored only as SHA-256. Revoking sets `revoked_at` — the next agent request returns `401`. `last_seen_at` is updated on every successful ingest call.
