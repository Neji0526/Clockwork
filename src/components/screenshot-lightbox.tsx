import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Shot = { storage_path: string; captured_at: string };

/**
 * Full-screen dark-overlay screenshot preview. Click backdrop / X / Esc to close.
 * Resolves a fresh signed URL for the `va-screenshots` bucket each time it opens.
 *
 * Two modes:
 *  - Single: pass `path`. No prev/next.
 *  - Reel:   pass `shots` + `initialIndex`. ← / → keys and on-screen arrows
 *            navigate. Clamps at the ends (no wrap). Caption shows the
 *            captured-at timestamp and i/n counter.
 */
export function ScreenshotLightbox({
  path,
  shots,
  initialIndex = 0,
  onClose,
}: {
  path?: string;
  shots?: Shot[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const reel = shots && shots.length > 0;
  const [idx, setIdx] = useState(() =>
    reel ? Math.min(Math.max(initialIndex, 0), shots!.length - 1) : 0
  );
  const current: Shot | null = reel
    ? shots![idx]
    : path
      ? { storage_path: path, captured_at: "" }
      : null;
  const currentPath = current?.storage_path ?? null;
  const total = reel ? shots!.length : 1;
  const atStart = idx <= 0;
  const atEnd = reel ? idx >= shots!.length - 1 : true;

  const goPrev = useCallback(() => {
    if (!reel) return;
    setIdx((i) => Math.max(0, i - 1));
  }, [reel]);
  const goNext = useCallback(() => {
    if (!reel) return;
    setIdx((i) => Math.min(shots!.length - 1, i + 1));
  }, [reel, shots]);

  const q = useQuery({
    queryKey: ["va-shot-full", currentPath],
    enabled: !!currentPath,
    queryFn: async () => {
      const { data } = await supabase.storage.from("va-screenshots").createSignedUrl(currentPath!, 300);
      return data?.signedUrl ?? null;
    },
    staleTime: 240_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm grid place-items-center p-4 animate-[fadeIn_0.18s_ease-out_both] cursor-zoom-out"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close preview"
        className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors"
      >
        <X className="size-5" />
      </button>

      {reel && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            disabled={atStart}
            aria-label="Previous screenshot"
            className="absolute left-4 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 text-white grid place-items-center transition-colors"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            disabled={atEnd}
            aria-label="Next screenshot"
            className="absolute right-4 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 text-white grid place-items-center transition-colors"
          >
            <ChevronRight className="size-6" />
          </button>
        </>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center cursor-default"
        style={{ maxWidth: "90vw", maxHeight: "90vh" }}
      >
        {!q.data ? (
          <div className="text-sm text-white/60 animate-pulse">Loading…</div>
        ) : (
          <img
            src={q.data}
            alt="Screenshot zoomed"
            style={{ maxWidth: "90vw", maxHeight: "90vh", width: "auto", height: "auto", objectFit: "contain" }}
            className="block rounded-lg shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
          />
        )}
      </div>

      {current?.captured_at && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 text-white/90 text-xs tabular-nums cursor-default"
        >
          {new Date(current.captured_at).toLocaleString()}
          {reel && <span className="ml-2 text-white/60">{idx + 1} / {total}</span>}
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>,
    document.body
  );
}
