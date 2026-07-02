# ClockWork

Transparent time tracking + auto-built SOPs for virtual assistants. Browser extension + web app.

## Remixing this app

This project is designed to be remixed and self-hosted on your own domain. Almost everything is domain-agnostic at runtime — but there are a few one-time setup steps the new owner has to do.

### 1. Publish + connect your domain
Click **Publish** in Lovable, then connect your custom domain in **Project Settings → Domains**.

### 2. Allowed redirect URLs (Auth)
Add your published URL and any custom domain to the Auth allowed-redirect list:
**Lovable Cloud → Users → URL Configuration → Redirect URLs**. Without this, OAuth, magic links, and password-reset emails will land on a rejected redirect.

### 3. Google sign-in (optional)
Google OAuth credentials do **not** carry over when remixing. If you want Google sign-in, ask the agent to enable Google in **Cloud → Auth → Providers** (it'll walk you through configuration). Email + password works out of the box.

### 4. Browser extension — set the dashboard URL
The popup has a "dashboard" link that opens your ClockWork site. After installing the unpacked extension:
1. Right-click the ClockWork icon → **Options**.
2. Paste your dashboard URL (e.g. `https://clockwork.yourcompany.com`).
3. Save.

The current packaged extension version is in `public/clockwork-extension.zip` and is shown on the `/install` page.

### 5. First admin user
The first person to sign up isn't auto-promoted — the admin role lives in the `user_roles` table. Either sign up yourself and ask the agent to grant you admin, or have the agent add a "first-user-becomes-admin" trigger.

### What's automatic (no action needed)
- Lovable Cloud database, auth, storage, and edge functions are provisioned fresh per remix.
- All canonical and OG metadata is derived from the request — no hardcoded domain in head tags.
- Password-reset email links use the request `Host` header — no hardcoded fallback.
- The in-app Guide sign-in URL is computed from `window.location.origin`.


## Desktop agent (multi-source ingest)

The backend accepts data from both the Chrome extension (`track-ingest`, Supabase user session) and a future native desktop agent (`agent-ingest`, per-device Bearer token). See [docs/AGENT_INGEST.md](docs/AGENT_INGEST.md) for the full endpoint URL, auth scheme, and payload shapes per event kind.

Admins mint and revoke device tokens at **Admin → VA detail → Connected devices**. Tokens are shown once; only their SHA-256 hash is stored.
