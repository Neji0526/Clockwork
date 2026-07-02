import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScreenshotLightbox } from "@/components/screenshot-lightbox";

/**
 * Admin-only "Capture now" button. Inserts a capture_requests row and waits
 * (via Postgres realtime on capture_requests + screenshots) for the VA's
 * extension to upload a fresh shot. Times out at ~95s. Opens the resulting
 * shot in the lightbox.
 */
export function CaptureNowButton({
  vaId,
  isClockedIn,
  size = "sm",
  variant = "outline",
  label = "Capture now",
}: {
  vaId: string;
  isClockedIn: boolean;
  size?: "sm" | "default" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  label?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [zoomPath, setZoomPath] = useState<string | null>(null);
  const reqIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  function cleanup() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    reqIdRef.current = null;
  }
  useEffect(() => () => cleanup(), []);

  async function resolveAndOpen(reqId: string) {
    const { data } = await supabase
      .from("capture_requests")
      .select("screenshot_id, status, reason")
      .eq("id", reqId)
      .maybeSingle();
    if (!data) return;
    if (data.status === "fulfilled" && data.screenshot_id) {
      const { data: shot } = await supabase
        .from("screenshots")
        .select("storage_path")
        .eq("id", data.screenshot_id)
        .maybeSingle();
      cleanup();
      setPending(false);
      qc.invalidateQueries({ queryKey: ["va-today", vaId] });
      qc.invalidateQueries({ queryKey: ["admin-live"] });
      if (shot?.storage_path) {
        toast.success("Screenshot captured");
        setZoomPath(shot.storage_path);
      }
    } else if (data.status === "failed") {
      cleanup();
      setPending(false);
      toast.error(data.reason || "Member's extension couldn't capture (protected page or no active tab).");
    }
  }

  async function onClick() {
    if (!user || pending || !isClockedIn) return;
    setPending(true);
    const { data, error } = await supabase
      .from("capture_requests")
      .insert({ va_id: vaId, requested_by: user.id })
      .select("id")
      .single();
    if (error || !data) {
      setPending(false);
      toast.error(error?.message ?? "Couldn't create capture request.");
      return;
    }
    reqIdRef.current = data.id;
    toast("Requesting a fresh screenshot…", { description: "Waiting on the member's extension." });

    const ch = supabase
      .channel(`cap-req:${data.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "capture_requests", filter: `id=eq.${data.id}` },
        () => resolveAndOpen(data.id))
      .subscribe();
    channelRef.current = ch;

    // 95s safety timeout (request expires at ~90s server-side).
    timerRef.current = setTimeout(async () => {
      // Final poll in case realtime missed the update.
      const { data: row } = await supabase
        .from("capture_requests").select("status, screenshot_id").eq("id", data.id).maybeSingle();
      if (row?.status === "fulfilled") {
        await resolveAndOpen(data.id);
        return;
      }
      // Mark expired (best-effort; admin can also expire via DB cron if added later).
      cleanup();
      setPending(false);
      toast.error("No response from the member's extension — are they clocked in with v0.4.4 installed?");
    }, 95_000);
  }

  const btn = (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={!isClockedIn || pending}
      className="gap-1.5"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
      {pending ? "Waiting…" : label}
    </Button>
  );

  return (
    <>
      {isClockedIn ? (
        btn
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild><span>{btn}</span></TooltipTrigger>
            <TooltipContent>Member is off the clock</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {zoomPath && <ScreenshotLightbox path={zoomPath} onClose={() => setZoomPath(null)} />}
    </>
  );
}
