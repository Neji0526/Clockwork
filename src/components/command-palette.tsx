import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

import {
  LayoutDashboard, BookOpen, Users, Download, LogOut, Play,
  Search, User as UserIcon, Sparkles, Settings as SettingsIcon,
  Link2, ArrowLeft, Activity, Timer, DollarSign, Briefcase,
  ScrollText, ShieldCheck, Sun, FileText,
} from "lucide-react";

type AdminSection = {
  // Either a Team tab (renders /admin?tab=...) or a path-based deep link (e.g. /financials).
  tab?: string;
  to?: string;
  section?: "invoices" | "payroll" | "timesheets" | "signals" | "productivity" | "audit";
  label: string;
  group: string;
  keywords: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const ADMIN_SECTIONS: readonly AdminSection[] = [
  { tab: "today",      group: "Team", label: "Today",      keywords: "today overview dashboard date roster live now active realtime on the clock who's online", Icon: Sun },
  { to: "/financials", section: "timesheets", group: "Financials", label: "Timesheets", keywords: "timesheets time hours sessions approve week", Icon: Timer },
  { to: "/financials",                       group: "Financials", label: "Invoices", keywords: "invoices billing brands clients money owed financials", Icon: FileText },
  { to: "/financials", section: "payroll",   group: "Financials", label: "Payroll",  keywords: "payroll pay wages financials billing", Icon: DollarSign },
  { tab: "clients",    group: "Team", label: "Brands",    keywords: "brands clients customers accounts", Icon: Briefcase },
  { tab: "vas",        group: "Team", label: "Members",    keywords: "members vas team people users assistants", Icon: Users },
  { to: "/sops", section: "signals", group: "SOPs", label: "Signals", keywords: "signals signatures workflows patterns detected suggested sops queue", Icon: Sparkles },
  { to: "/admin/settings", section: "productivity", group: "Settings", label: "Productivity rules", keywords: "productivity rules classify hosts apps unproductive neutral activity", Icon: Activity },
  { to: "/admin/settings", section: "audit",        group: "Settings", label: "Audit log",          keywords: "audit log security history actions admin record", Icon: ScrollText },
];


type Sop = { id: string; title: string };
type Va = { user_id: string; display_name: string | null; role: string };

type Mode = "root" | "jump-va" | "share-va";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("root");
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === "admin";
  

  // Toggle on ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset to root each time the palette opens.
  useEffect(() => { if (open) setMode("root"); }, [open]);

  // Lightweight SOP search source — only fetched when palette opens
  const sopsQ = useQuery({
    queryKey: ["sops-palette"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("sops")
        .select("id, title")
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(40);
      return (data ?? []) as Sop[];
    },
  });

  // VA roster — admin only, fetched the first time the palette opens for admins.
  const vasQ = useQuery({
    queryKey: ["vas-palette"],
    enabled: open && isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role")
        .order("display_name");
      return (data ?? []) as Va[];
    },
  });

  const sops = useMemo(() => sopsQ.data ?? [], [sopsQ.data]);
  const vas = useMemo(
    () => (vasQ.data ?? []).filter(v => v.user_id !== profile?.user_id),
    [vasQ.data, profile?.user_id],
  );

  function go(to: string) {
    setOpen(false);
    navigate({ to });
  }

  function jumpToVa(vaId: string) {
    setOpen(false);
    navigate({ to: "/admin_/$vaId", params: { vaId } });
  }

  function generateShareLink(va: Va) {
    // Share links are per-(VA, client); the admin must pick a client. Route to
    // the VA admin page where the client picker + token UI lives.
    setOpen(false);
    navigate({ to: "/admin_/$vaId", params: { vaId: va.user_id }, hash: "share" });
  }


  const placeholder =
    mode === "jump-va" ? "Jump to a member…"
    : mode === "share-va" ? "Pick a member to share with the brand…"
    : "Jump to anywhere — pages, SOPs, actions…";

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {mode === "root" && (
          <>
            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => go(isAdmin ? "/me" : "/")}>
                <LayoutDashboard className="size-4" />{isAdmin ? "Dashboard" : "My day"}
                <CommandShortcut>G H</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => go("/sops")}>
                <BookOpen className="size-4" />SOP library
                <CommandShortcut>G S</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => go("/install")}>
                <Download className="size-4" />Install extension
                <CommandShortcut>G I</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => go("/settings")}>
                <UserIcon className="size-4" />Account
                <CommandShortcut>G ,</CommandShortcut>
              </CommandItem>
              {isAdmin && (
                <>
                  <CommandItem onSelect={() => go("/admin")}>
                    <Users className="size-4" />Team admin
                    <CommandShortcut>G T</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => go("/admin/settings")}>
                    <SettingsIcon className="size-4" />Settings
                  </CommandItem>
                </>
              )}
            </CommandGroup>

            {isAdmin && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Admin actions">
                  <CommandItem
                    value="jump-to-va action"
                    onSelect={() => setMode("jump-va")}
                  >
                    <UserIcon className="size-4" />Jump to member…
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    value="generate client share link action"
                    onSelect={() => setMode("share-va")}
                  >
                    <Link2 className="size-4" />Generate brand share link…
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Sections">
                  {ADMIN_SECTIONS.map(({ tab, to, section, label, group, keywords, Icon }) => (
                    <CommandItem
                      key={`${group}-${tab ?? to}-${section ?? ""}`}
                      value={`${group.toLowerCase()}-${tab ?? to}-${section ?? ""} ${label} ${keywords}`}
                      onSelect={() => {
                        setOpen(false);
                        if (to) {
                          navigate({
                            to,
                            search: section && section !== "invoices" ? { section } : {},
                          } as any);
                        } else {
                          navigate({
                            to: "/admin",
                            search: { tab: tab === "today" ? undefined : tab },
                          });
                        }
                      }}
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        {group}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}


            {sops.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="SOPs">
                  {sops.slice(0, 8).map(s => (
                    <CommandItem
                      key={s.id}
                      value={`sop-${s.id}-${s.title}`}
                      onSelect={() => {
                        setOpen(false);
                        navigate({ to: "/sops/$sopId", params: { sopId: s.id } });
                      }}
                    >
                      <Play className="size-4 text-gold" />
                      <span className="truncate">{s.title}</span>
                    </CommandItem>
                  ))}
                  <CommandItem onSelect={() => go("/sops")}>
                    <Search className="size-4" />Browse all SOPs…
                  </CommandItem>
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading="Account">
              <CommandItem disabled>
                <UserIcon className="size-4" />
                <span className="truncate">{profile?.display_name ?? "—"}</span>
                <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-gold">
                  <Sparkles className="size-3 inline mr-1" />{profile?.role}
                </span>
              </CommandItem>
              <CommandItem
                onSelect={async () => {
                  setOpen(false);
                  await signOut();
                  navigate({ to: "/auth" });
                }}
              >
                <LogOut className="size-4" />Sign out
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {mode !== "root" && isAdmin && (
          <>
            <CommandGroup heading={mode === "jump-va" ? "Jump to member" : "Generate share link for…"}>
              <CommandItem value="back to commands" onSelect={() => setMode("root")}>
                <ArrowLeft className="size-4" />Back to all commands
              </CommandItem>
              {vasQ.isLoading && (
                <CommandItem disabled>Loading team…</CommandItem>
              )}
              {!vasQ.isLoading && vas.length === 0 && (
                <CommandItem disabled>No teammates yet.</CommandItem>
              )}
              {vas.map(v => (
                <CommandItem
                  key={v.user_id}
                  value={`va-${v.user_id}-${v.display_name ?? "unnamed"}`}
                  onSelect={() => mode === "jump-va" ? jumpToVa(v.user_id) : generateShareLink(v)}
                >
                  {mode === "jump-va" ? <UserIcon className="size-4" /> : <Link2 className="size-4 text-gold" />}
                  <span className="truncate">{v.display_name ?? "Unnamed"}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    {v.role}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="border-t border-border px-3 py-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Press
          <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-md border border-border bg-card text-[10px] font-medium shadow-soft">?</kbd>
          for keyboard shortcuts
        </span>
        <span className="hidden sm:flex items-center gap-1.5">
          <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-md border border-border bg-card text-[10px] font-medium shadow-soft">G</kbd>
          then a letter to jump
        </span>
      </div>
    </CommandDialog>
  );
}
