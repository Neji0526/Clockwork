import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ListOrdered } from "lucide-react";
import { ClockMark } from "@/components/clock-mark";

export type GuideSection = {
  id: string;
  number: number;
  title: string;
  body: React.ReactNode;
};

export type GuideDoc = {
  kind: "user" | "admin";
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
  sections: GuideSection[];
};

export function GuideView({ doc, headerActions }: { doc: GuideDoc; headerActions?: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string>(doc.sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 1] },
    );
    doc.sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [doc]);

  // Walk up to find the nearest actually-scrolling ancestor (overflow auto/scroll
  // with real overflow). Falls back to the document scrolling element / window.
  const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
    let el: HTMLElement | null = node?.parentElement ?? null;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  };

  const scrollToId = (id: string, smooth = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    const container = getScrollParent(el);
    const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
    if (container) {
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top, behavior });
    } else {
      el.scrollIntoView({ behavior, block: "start" });
    }
    setActiveId(id);
  };

  const onTocClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    history.replaceState(null, "", `#${id}`);
    scrollToId(id, true);
  };

  // Honor a direct-visit hash once sections are mounted.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const t = window.setTimeout(() => scrollToId(hash, false), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return (
    <div className="guide-root">
      {/* Print-only header */}
      <div className="hidden print:block print-header">
        <div className="flex items-center gap-2">
          <ClockMark size={28} className="text-primary" />
          <span className="font-display text-2xl">ClockWork</span>
          <span className="ml-auto text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {doc.kind === "admin" ? "Admin guide" : "User guide"}
          </span>
        </div>
        <div className="mt-1 h-px bg-border" />
      </div>

      <header className="guide-no-print mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-2">{doc.eyebrow}</div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">{doc.title}</h1>
          <p className="mt-3 text-muted-foreground max-w-2xl text-[15px] leading-relaxed">{doc.lede}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <Button
            onClick={() => window.print()}
            variant="outline"
            className="press"
          >
            <Download className="size-4 mr-1.5" /> Download PDF
          </Button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        {/* Sticky TOC */}
        <aside className="guide-no-print order-2 lg:order-1">
          <nav className="lg:sticky lg:top-6">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-3 flex items-center gap-2">
              <ListOrdered className="size-3.5" /> Contents
            </div>
            <ol className="space-y-1 text-sm">
              {doc.sections.map((s) => {
                const active = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={(e) => onTocClick(e, s.id)}
                      className={`block rounded-md px-2 py-1.5 transition-colors leading-snug ${
                        active
                          ? "bg-sidebar-accent text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <span className="tabular-nums text-gold mr-1.5">{s.number}.</span>
                      {s.title}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {/* Body */}
        <article className="order-1 lg:order-2 max-w-3xl">
          <div className="space-y-10">
            {doc.sections.map((s) => (
              <section key={s.id} id={s.id} className="guide-section scroll-mt-24">
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="font-display text-3xl text-gold tabular-nums">{s.number}</span>
                  <h2 className="font-display text-2xl md:text-3xl leading-tight">{s.title}</h2>
                </div>
                <div className="guide-prose text-[15px] leading-[1.7] text-foreground/90">{s.body}</div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

// Helpers for building content
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3">{children}</p>;
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 mb-3 marker:text-gold/70">{children}</ul>;
}
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gold/25 bg-gold/[0.05] p-4 my-4 text-[14.5px]">
      {children}
    </div>
  );
}

/** Renders the current site's sign-in URL as a styled link. Client-side only;
 * during SSR shows a relative "/auth" so nothing is hardcoded per-deploy. */
export function SignInUrl() {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const href = origin ? `${origin}/auth` : "/auth";
  const display = origin ? `${origin}/auth` : "/auth";
  return (
    <a href={href} className="text-gold underline-offset-4 hover:underline">
      {display}
    </a>
  );
}

