// Workspace settings — admin-only app_config + billing identity, plus
// productivity-rule config and the admin audit log (both moved here from
// the old Team → More dropdown). Reachable from the sidebar gear and the
// Quick-jump palette. Personal account settings remain at /settings.
import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DollarSign, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { ProductivityRulesPanel } from "@/components/admin/settings/productivity-rules-panel";
import { AuditLogPanel } from "@/components/admin/settings/audit-log-panel";
import { AdminAccessPanel } from "@/components/admin/settings/admin-access-panel";

const SETTINGS_SECTIONS = ["workspace", "admin-access", "productivity", "audit"] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_TITLE: Record<SettingsSection, string> = {
  workspace: "Settings — ClockWork",
  "admin-access": "Admin access — Settings — ClockWork",
  productivity: "Productivity rules — Settings — ClockWork",
  audit: "Audit log — Settings — ClockWork",
};

export const Route = createFileRoute("/admin_/settings")({
  // Title is set dynamically per section in the component (multiple admin
  // tabs are common — distinct titles make them easy to tell apart).
  head: ({ match }) => {
    const sec = (match.search as { section?: SettingsSection }).section ?? "workspace";
    return { meta: [{ title: SECTION_TITLE[sec] ?? SECTION_TITLE.workspace }] };
  },
  validateSearch: (s: Record<string, unknown>): { section?: SettingsSection } => {
    const sec = typeof s.section === "string" ? s.section : undefined;
    return {
      section: (SETTINGS_SECTIONS as readonly string[]).includes(sec ?? "")
        ? (sec as SettingsSection)
        : undefined,
    };
  },
  component: () => (
    <RequireAuth><WorkspaceSettingsGate /></RequireAuth>
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared dirty-bar context
// Each form registers itself by key with its label + dirty/busy/save handle.
// The sticky bar reads the registry and renders one button per dirty section.
// No save() implementations change — the same function reference is reused.
// ─────────────────────────────────────────────────────────────────────────────

type DirtySection = {
  label: string;
  dirty: boolean;
  busy: boolean;
  save: () => Promise<void> | void;
};

type DirtyRegistry = Record<string, DirtySection>;

type DirtyBarCtx = {
  register: (key: string, section: DirtySection) => void;
  unregister: (key: string) => void;
};

const DirtyBarContext = createContext<DirtyBarCtx | null>(null);
const DirtyBarStateContext = createContext<DirtyRegistry>({});

function DirtyBarProvider({ children }: { children: React.ReactNode }) {
  const [sections, setSections] = useState<DirtyRegistry>({});
  const register = useCallback((key: string, section: DirtySection) => {
    setSections((prev) => {
      const existing = prev[key];
      if (
        existing &&
        existing.label === section.label &&
        existing.dirty === section.dirty &&
        existing.busy === section.busy &&
        existing.save === section.save
      ) return prev;
      return { ...prev, [key]: section };
    });
  }, []);
  const unregister = useCallback((key: string) => {
    setSections((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const ctx = useMemo(() => ({ register, unregister }), [register, unregister]);
  return (
    <DirtyBarContext.Provider value={ctx}>
      <DirtyBarStateContext.Provider value={sections}>
        {children}
      </DirtyBarStateContext.Provider>
    </DirtyBarContext.Provider>
  );
}

function useRegisterDirtySection(key: string, section: DirtySection) {
  const ctx = useContext(DirtyBarContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(key, section);
    return () => ctx.unregister(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, section.label, section.dirty, section.busy, section.save]);
}

function UnsavedChangesBar() {
  const sections = useContext(DirtyBarStateContext);
  const dirtyEntries = Object.entries(sections).filter(([, s]) => s.dirty);
  if (dirtyEntries.length === 0) return null;

  const labels = dirtyEntries.map(([, s]) => s.label);
  const summary =
    labels.length === 1
      ? labels[0]
      : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];

  return (
    <div
      className="fixed inset-x-3 bottom-3 sm:left-auto sm:right-6 sm:bottom-6 z-40 pb-[env(safe-area-inset-bottom)] animate-[fadeUpBar_220ms_ease-out_both]"
      role="region"
      aria-label="Unsaved changes"
    >
      <div className="mx-auto sm:mx-0 max-w-2xl sm:max-w-none rounded-full border border-border bg-card/95 backdrop-blur-md shadow-elevated pl-4 pr-2 py-2 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-xs text-foreground/80 min-w-0">
          <span className="size-1.5 rounded-full bg-gold shrink-0" aria-hidden />
          <span className="truncate">
            You have unsaved changes in <span className="font-medium text-foreground">{summary}</span>
          </span>
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          {dirtyEntries.map(([key, s]) => (
            <Button
              key={key}
              size="sm"
              className="h-8 rounded-full"
              disabled={s.busy}
              onClick={() => { void s.save(); }}
            >
              {s.busy
                ? "Saving…"
                : dirtyEntries.length === 1
                  ? `Save ${s.label.toLowerCase()}`
                  : `Save ${shortLabel(s.label)}`}
              {!s.busy && <Sparkles className="size-3 ml-0.5" />}
            </Button>
          ))}
        </div>
      </div>
      <style>{`@keyframes fadeUpBar { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

function shortLabel(label: string) {
  // "Workspace settings" → "workspace"; "Billing identity" → "billing"
  return label.split(" ")[0].toLowerCase();
}

function WorkspaceSettingsGate() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return <AppShell><p className="text-sm text-muted-foreground">Admin only.</p></AppShell>;
  }
  return (
    <AppShell>
      <DirtyBarProvider>
        <SettingsBody />
        <UnsavedChangesBar />
      </DirtyBarProvider>
    </AppShell>
  );
}

function SettingsBody() {
  const navigate = Route.useNavigate();
  const { section: sectionFromUrl } = Route.useSearch();
  const section: SettingsSection = sectionFromUrl ?? "workspace";

  const setSection = (next: SettingsSection) => {
    navigate({
      search: { section: next === "workspace" ? undefined : next },
      replace: true,
    });
  };

  const sections: { value: SettingsSection; label: string }[] = [
    { value: "workspace", label: "Workspace" },
    { value: "admin-access", label: "Admin access" },
    { value: "productivity", label: "Productivity rules" },
    { value: "audit", label: "Audit log" },
  ];

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="inline-flex items-center gap-1 rounded-full bg-muted/60 p-1 ring-1 ring-border"
      >
        {sections.map(s => {
          const active = section === s.value;
          return (
            <button
              key={s.value}
              role="tab"
              aria-selected={active}
              onClick={() => setSection(s.value)}
              className={`press inline-flex items-center px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {section === "workspace" && <SettingsPanel />}
      {section === "admin-access" && <AdminAccessPanel />}
      {section === "productivity" && <ProductivityRulesPanel />}
      {section === "audit" && <AuditLogPanel />}
    </div>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(30);
  const [idleMin, setIdleMin] = useState<number>(5);
  const [maxBreakMin, setMaxBreakMin] = useState<number>(60);
  const [lowEngageMin, setLowEngageMin] = useState<number>(10);
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState<number>(10);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["app-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select("screenshot_retention_days, idle_threshold_sec, max_break_sec, low_engagement_minutes, session_timeout_minutes, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (q.data?.screenshot_retention_days) setDays(q.data.screenshot_retention_days);
    if (q.data?.idle_threshold_sec) setIdleMin(Math.round(q.data.idle_threshold_sec / 60));
    if (q.data?.max_break_sec) setMaxBreakMin(Math.round(q.data.max_break_sec / 60));
    if ((q.data as any)?.low_engagement_minutes) setLowEngageMin((q.data as any).low_engagement_minutes);
    if ((q.data as any)?.session_timeout_minutes) setSessionTimeoutMin((q.data as any).session_timeout_minutes);
  }, [q.data?.screenshot_retention_days, q.data?.idle_threshold_sec, q.data?.max_break_sec, (q.data as any)?.low_engagement_minutes, (q.data as any)?.session_timeout_minutes]);

  const save = useCallback(async () => {
    const n = Math.max(1, Math.min(3650, Math.floor(days)));
    const it = Math.max(60, Math.min(3600, Math.floor(idleMin * 60)));
    const mb = Math.max(300, Math.min(14400, Math.floor(maxBreakMin * 60)));
    const le = Math.max(2, Math.min(120, Math.floor(lowEngageMin)));
    const st = Math.max(2, Math.min(240, Math.floor(sessionTimeoutMin)));
    setBusy(true);
    try {
      const { error } = await supabase
        .from("app_config")
        .update({
          screenshot_retention_days: n,
          idle_threshold_sec: it,
          max_break_sec: mb,
          low_engagement_minutes: le,
          session_timeout_minutes: st,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", 1);
      if (error) throw error;
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["app-config"] });
      qc.invalidateQueries({ queryKey: ["app-config-timeouts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally { setBusy(false); }
  }, [days, idleMin, maxBreakMin, lowEngageMin, sessionTimeoutMin, qc]);

  const dirty = !!(q.data && (
    days !== q.data.screenshot_retention_days ||
    idleMin !== Math.round((q.data.idle_threshold_sec ?? 300) / 60) ||
    maxBreakMin !== Math.round((q.data.max_break_sec ?? 3600) / 60) ||
    lowEngageMin !== ((q.data as any).low_engagement_minutes ?? 10) ||
    sessionTimeoutMin !== ((q.data as any).session_timeout_minutes ?? 10)
  ));

  useRegisterDirtySection("workspace", {
    label: "Workspace settings",
    dirty,
    busy,
    save,
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium inline-flex items-center gap-1.5">
            <SettingsIcon className="size-3 text-gold/80" /> Workspace
          </div>
          <h1 className="font-display text-3xl md:text-4xl leading-[1.05] tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            Retention, idle thresholds, and break warnings — applied across every member on your team.
          </p>
        </div>
        {q.data?.updated_at && (
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Last updated</div>
            <div className="text-xs text-foreground/80 tabular-nums">{new Date(q.data.updated_at).toLocaleString()}</div>
          </div>
        )}
      </header>

      <div className="surface-card p-5 md:p-6 space-y-5 md:max-w-3xl">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ret-days" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Keep screenshots</Label>
            <div className="flex items-baseline gap-2">
              <Input id="ret-days" type="number" min={1} max={3650} value={days}
                onChange={(e) => setDays(Number(e.target.value))} className="w-24 h-10 text-lg tabular-nums" />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idle-min" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Idle after</Label>
            <div className="flex items-baseline gap-2">
              <Input id="idle-min" type="number" min={1} max={60} value={idleMin}
                onChange={(e) => setIdleMin(Number(e.target.value))} className="w-24 h-10 text-lg tabular-nums" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-break" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Break warning</Label>
            <div className="flex items-baseline gap-2">
              <Input id="max-break" type="number" min={5} max={240} value={maxBreakMin}
                onChange={(e) => setMaxBreakMin(Number(e.target.value))} className="w-24 h-10 text-lg tabular-nums" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="low-engage" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Low-engagement alert</Label>
            <div className="flex items-baseline gap-2">
              <Input id="low-engage" type="number" min={2} max={120} value={lowEngageMin}
                onChange={(e) => setLowEngageMin(Number(e.target.value))} className="w-24 h-10 text-lg tabular-nums" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-timeout" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Session timeout</Label>
            <div className="flex items-baseline gap-2">
              <Input id="session-timeout" type="number" min={2} max={240} value={sessionTimeoutMin}
                onChange={(e) => setSessionTimeoutMin(Number(e.target.value))} className="w-24 h-10 text-lg tabular-nums" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Idle threshold controls when ClockWork nudges a member to confirm they're still working.
          The break warning fires when a single break exceeds the configured length.
          Low-engagement flags stretches where a member is clocked in and active but registers no clicks, typing, or scrolling for at least this many minutes (counts only — never keystrokes or text).
          Session timeout auto-ends a session after this many minutes with no activity (browser closed, machine asleep, extension stopped) — recorded hours are capped at the last real activity, not the idle gap.
        </p>

        <div className="flex items-center gap-3 pt-1 border-t border-border/60">
          <Button onClick={save} disabled={busy || q.isLoading || !dirty} className="press">
            {busy ? "Saving…" : dirty ? "Save settings" : "Saved"}
          </Button>
          {dirty && <span className="text-xs text-amber-500">Unsaved changes</span>}
        </div>
      </div>
      <BillingIdentityCard />
    </div>
  );
}

function BillingIdentityCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["billing-identity"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("admin_get_billing_config");
      return (Array.isArray(data) ? data[0] : data) ?? {};
    },
  });
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [email, setEmail] = useState("");
  const [logo, setLogo] = useState("");
  const [cur, setCur] = useState("USD");
  const [pay, setPay] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setName(q.data.billing_business_name ?? "");
    setAddr(q.data.billing_address ?? "");
    setEmail(q.data.billing_email ?? "");
    setLogo(q.data.billing_logo_url ?? "");
    setCur(q.data.billing_default_currency ?? "USD");
    setPay(q.data.billing_payment_notes ?? "");
  }, [q.data]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("app_config").update({
        billing_business_name: name || null,
        billing_address: addr || null,
        billing_email: email || null,
        billing_logo_url: logo || null,
        billing_default_currency: cur || "USD",
        billing_payment_notes: pay || null,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      toast.success("Billing identity saved");
      qc.invalidateQueries({ queryKey: ["billing-identity"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); } finally { setBusy(false); }
  }, [name, addr, email, logo, cur, pay, qc]);

  const dirty = !!(q.data && (
    name !== (q.data.billing_business_name ?? "") ||
    addr !== (q.data.billing_address ?? "") ||
    email !== (q.data.billing_email ?? "") ||
    logo !== (q.data.billing_logo_url ?? "") ||
    cur !== (q.data.billing_default_currency ?? "USD") ||
    pay !== (q.data.billing_payment_notes ?? "")
  ));

  useRegisterDirtySection("billing", {
    label: "Billing identity",
    dirty,
    busy,
    save,
  });

  return (
    <div className="surface-card p-5 md:p-6 space-y-4 md:max-w-3xl">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1 inline-flex items-center gap-1.5"><DollarSign className="size-3" /> Billing identity</div>
        <h3 className="font-display text-xl leading-tight">Invoice header.</h3>
        <p className="text-xs text-muted-foreground mt-1">Shown on every brand invoice you generate.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Business name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Operations LLC" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Billing email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@acme.com" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Address</Label>
          <textarea value={addr} onChange={(e) => setAddr(e.target.value)} rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Street, City, Country" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Logo URL (optional)</Label>
          <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Default currency</Label>
          <Select value={cur} onValueChange={setCur}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["USD","EUR","GBP","CAD","AUD","PHP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Payment instructions / notes</Label>
          <textarea value={pay} onChange={(e) => setPay(e.target.value)} rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Wire details, PayPal, terms — appears at the bottom of each invoice." />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1 border-t border-border/60">
        <Button onClick={save} disabled={busy || q.isLoading || !dirty} className="press">
          {busy ? "Saving…" : dirty ? "Save billing identity" : "Saved"}
        </Button>
        {dirty && <span className="text-xs text-amber-500">Unsaved changes</span>}
      </div>
    </div>
  );
}
