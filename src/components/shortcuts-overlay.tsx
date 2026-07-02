import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

type Shortcut = { keys: string[]; label: string };

const groups: { heading: string; items: Shortcut[] }[] = [
  {
    heading: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close dialogs / cinema mode" },
    ],
  },
  {
    heading: "Navigation",
    items: [
      { keys: ["G", "H"], label: "Go to My day" },
      { keys: ["G", "S"], label: "Go to SOP library" },
      { keys: ["G", "I"], label: "Go to Install extension" },
      { keys: ["G", "T"], label: "Go to Team admin" },
      { keys: ["G", ","], label: "Go to Settings" },
    ],
  },
  {
    heading: "SOP playback",
    items: [
      { keys: ["←"], label: "Previous step" },
      { keys: ["→"], label: "Next step" },
      { keys: ["Space"], label: "Play / pause auto-advance" },
      { keys: ["F"], label: "Toggle cinema mode" },
    ],
  },
];

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // "?" — ignore when typing in fields
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Keyboard className="size-5 text-gold" />
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="mt-3 space-y-6">
          {groups.map(g => (
            <div key={g.heading}>
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-2">{g.heading}</div>
              <ul className="space-y-1.5">
                {g.items.map(s => (
                  <li key={s.label} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0">
                    <span className="text-sm">{s.label}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 rounded-md border border-border bg-card text-[11px] font-medium tabular-nums shadow-soft"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
