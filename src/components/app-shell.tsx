import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  LogOut, LayoutDashboard, BookOpen, Users, User as UserIcon, Download,
  Search, Menu, X, LifeBuoy, Settings as SettingsIcon, Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ClockMark } from "@/components/clock-mark";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { GoToNav } from "@/components/go-to-nav";
import { NotificationsBell } from "@/components/notifications-bell";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = profile?.role === "admin";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const nav: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; show: boolean }[] = [
    { to: isAdmin ? "/me" : "/", label: isAdmin ? "Dashboard" : "My day", icon: LayoutDashboard, show: true },
    { to: "/sops", label: "SOPs", icon: BookOpen, show: true },
    { to: "/install", label: "Install extension", icon: Download, show: true },
    { to: "/guide", label: "Guide", icon: LifeBuoy, show: true },
    { to: "/admin", label: "Team", icon: Users, show: isAdmin },
    { to: "/financials", label: "Financials", icon: Wallet, show: isAdmin },
    { to: "/admin/settings", label: "Settings", icon: SettingsIcon, show: isAdmin },
  ];

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const SidebarBody = (
    <>
      <div className="flex items-center gap-2.5 px-1 py-1">
        <ClockMark size={32} className="text-primary shrink-0" />
        <div className="leading-tight">
          <div className="font-display text-2xl">ClockWork</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">since today</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          // Synthesize the same shortcut the palette listens for
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
        className="mt-5 group flex items-center gap-2 w-full rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors press"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Quick jump</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      <nav className="mt-6 space-y-0.5">
        {nav.filter(n => n.show).map(n => {
          const candidates = nav.filter(x => x.show && (pathname === x.to || (x.to !== "/" && pathname.startsWith(x.to + "/"))));
          const best = candidates.sort((a, b) => b.to.length - a.to.length)[0];
          const active = best?.to === n.to;
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all duration-200 ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground hover:translate-x-0.5"
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r-full transition-all ${
                  active ? "bg-gold opacity-100" : "opacity-0"
                }`}
              />
              <Icon className={`size-4 transition-colors ${active ? "text-primary" : ""}`} /> {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-sidebar-border space-y-2">
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            className="flex-1 block rounded-md px-2 py-1.5 hover:bg-sidebar-accent/50 transition-colors"
          >
            <div className="text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center size-6 rounded-full bg-primary/10 text-primary">
                  <UserIcon className="size-3" />
                </span>
                <span className="truncate font-medium text-sidebar-foreground/90">{profile?.display_name ?? "—"}</span>
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-gold">
                {profile?.role}
              </div>
            </div>
          </Link>
          {isAdmin && <NotificationsBell />}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
        >
          <LogOut className="size-4 mr-2" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="ambient-backdrop min-h-screen flex bg-background">
      <CommandPalette />
      <ShortcutsOverlay />
      <GoToNav />

      <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl p-5">
        {SidebarBody}
      </aside>

      <main className="flex-1 min-w-0">
        {/* mobile top bar */}
        <div className="md:hidden flex items-center justify-between surface-glass px-4 py-3 sticky top-0 z-20">
          <div className="flex items-center gap-2.5">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 px-2" aria-label="Open menu">
                  {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-5 flex flex-col bg-sidebar">
                {SidebarBody}
              </SheetContent>
            </Sheet>
            <ClockMark size={28} className="text-primary shrink-0" />
            <span className="font-display text-xl">ClockWork</span>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && <NotificationsBell />}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Search"
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            >
              <Search className="size-4" />
            </Button>
          </div>
        </div>
        <div className="md:hidden flex border-b overflow-x-auto bg-background/60 backdrop-blur sticky top-[57px] z-10">
          {nav.filter(n => n.show).map(n => {
            const candidates = nav.filter(x => x.show && (pathname === x.to || (x.to !== "/" && pathname.startsWith(x.to + "/"))));
            const best = candidates.sort((a, b) => b.to.length - a.to.length)[0];
            const active = best?.to === n.to;
            return (
              <Link key={n.to} to={n.to} className={`px-4 py-2.5 text-sm whitespace-nowrap transition ${active ? "border-b-2 border-gold text-foreground font-medium" : "text-muted-foreground"}`}>
                {n.label}
              </Link>
            );
          })}
        </div>
        <div key={pathname} className="page-enter p-5 md:p-10 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
