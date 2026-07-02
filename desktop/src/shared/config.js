// ClockWork Desktop — shared constants.
//
// These are copied VERBATIM from the Chrome extension's background.js so the
// backend contract (Supabase project, ingest endpoint, auth endpoint, default
// sampling settings, queue caps, storage keys) is byte-for-byte identical.
// Do NOT change these values — the migration must preserve business rules.

const SUPABASE_URL = "https://johibfayobgerhzjbisu.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvaGliZmF5b2JnZXJoempiaXN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTk3NjcsImV4cCI6MjA5Njg3NTc2N30.L_U3HWFg6bp3ZIKtrJfvKtUYeEofgmV3j9aKm5U713E";
const INGEST_URL = `${SUPABASE_URL}/functions/v1/track-ingest`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1/token`;

const DEFAULTS = {
  idleSeconds: 300,
  shotMinutes: 5,
  workflowGapSec: 30,
  workflowMaxSteps: 25,
  // session timeout (minutes) for sleep/wake recovery — must match server default
  sessionTimeoutMin: 10,
  blocklist: ["johibfayobgerhzjbisu.supabase.co", "accounts.google.com"],
};

const QUEUE_MAX = 500; // hard cap
const QUEUE_KEY = "wt-queue";
const SYNC_KEY = "wt-last-sync"; // ms timestamp of last successful ingest
const REAUTH_KEY = "wt-needs-reauth";
const VERSION_KEY = "wt-version-info"; // { latest, min, install_url, checkedAt }
const LAST_SHOT_KEY = "wt-last-shot-at";
const DEFAULT_VERSION_HOST = "https://clockwork.aiforbusiness.com";

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON,
  INGEST_URL,
  AUTH_URL,
  DEFAULTS,
  QUEUE_MAX,
  QUEUE_KEY,
  SYNC_KEY,
  REAUTH_KEY,
  VERSION_KEY,
  LAST_SHOT_KEY,
  DEFAULT_VERSION_HOST,
};
