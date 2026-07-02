import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Monitor, Plus, Copy, Trash2, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  listDeviceTokens, mintDeviceToken, revokeDeviceToken,
} from "@/lib/device-tokens.functions";

type Platform = "macos" | "windows" | "linux";
const PLATFORM_LABEL: Record<Platform, string> = {
  macos: "macOS", windows: "Windows", linux: "Linux",
};

function rel(ts: string | null) {
  if (!ts) return "never";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function DevicesPanel({ vaId }: { vaId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listDeviceTokens);
  const mint = useServerFn(mintDeviceToken);
  const revoke = useServerFn(revokeDeviceToken);

  const q = useQuery({
    queryKey: ["device-tokens", vaId],
    queryFn: () => list({ data: { va_id: vaId } }),
  });

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<Platform>("macos");
  const [pending, setPending] = useState(false);
  const [showToken, setShowToken] = useState<string | null>(null);

  async function handleMint() {
    if (!label.trim()) { toast.error("Give the device a label"); return; }
    setPending(true);
    try {
      const r = await mint({ data: { va_id: vaId, label: label.trim(), platform } });
      setShowToken(r.token);
      setLabel("");
      setPlatform("macos");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["device-tokens", vaId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not mint token");
    } finally { setPending(false); }
  }

  async function handleRevoke(id: string, label: string) {
    if (!confirm(`Revoke "${label}"? The desktop agent on this device will stop syncing immediately.`)) return;
    try {
      await revoke({ data: { id } });
      qc.invalidateQueries({ queryKey: ["device-tokens", vaId] });
      toast.success("Device revoked");
    } catch (e: any) {
      toast.error(e?.message ?? "Revoke failed");
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="size-4" />Connected devices
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Native desktop agents (macOS / Windows / Linux) authenticate with a per-device token.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <Plus className="size-3.5 mr-1.5" />Register a device
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register a device</DialogTitle>
              <DialogDescription>
                Generates a token to paste into the desktop agent. The token is shown once and stored only as a hash.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dev-label">Label</Label>
                <Input id="dev-label" placeholder="e.g. Moi's MacBook" value={label}
                       onChange={(e) => setLabel(e.target.value)} maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="macos">macOS</SelectItem>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button onClick={handleMint} disabled={pending}>{pending ? "Minting…" : "Generate token"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) =>
            <div key={i} className="h-12 rounded bg-muted/40 animate-pulse" />)}</div>
        ) : (q.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No devices registered yet. The desktop agent is optional — the Chrome extension continues to work as before.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {q.data!.map((d: any) => {
              const revoked = !!d.revoked_at;
              return (
                <li key={d.id} className="py-2 flex items-center gap-3 text-sm">
                  <Monitor className={`size-4 ${revoked ? "text-muted-foreground" : "text-primary"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {d.label}
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {PLATFORM_LABEL[d.platform as Platform] ?? d.platform}
                      </span>
                      {revoked && (
                        <span className="text-[10px] uppercase tracking-wider text-destructive">Revoked</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last seen {rel(d.last_seen_at)} · Added {new Date(d.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {!revoked && (
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(d.id, d.label)} title="Revoke">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* One-time token reveal */}
      <Dialog open={!!showToken} onOpenChange={(o) => { if (!o) setShowToken(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" />Token created
            </DialogTitle>
            <DialogDescription>
              Paste this into the desktop agent now. For security, it won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-warning/40 bg-warning/10 text-warning text-xs px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <span>Treat this like a password. If lost, revoke the device and mint a new one.</span>
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all select-all">
            {showToken}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => copy(showToken!)}>
              <Copy className="size-3.5 mr-1.5" />Copy
            </Button>
            <Button onClick={() => setShowToken(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
