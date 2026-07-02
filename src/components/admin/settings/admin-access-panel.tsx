// Admin access — generate & manage one-time invite links that promote the
// redeemer to admin, and revoke any active links. Backed by the RPCs in
// src/lib/admin-invites.functions.ts.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createAdminInvite,
  listAdminInvites,
  revokeAdminInvite,
} from "@/lib/admin-invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Link as LinkIcon, ShieldCheck, Trash2 } from "lucide-react";

type Invite = {
  id: string;
  token: string;
  label: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

function inviteUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/admin-invite/${token}`;
}

function statusOf(inv: Invite): { label: string; tone: "ok" | "warn" | "dead" } {
  if (inv.revoked_at) return { label: "Revoked", tone: "dead" };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { label: "Expired", tone: "dead" };
  if (inv.uses >= inv.max_uses) return { label: "Used up", tone: "dead" };
  return { label: "Active", tone: "ok" };
}

export function AdminAccessPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listAdminInvites);
  const create = useServerFn(createAdminInvite);
  const revoke = useServerFn(revokeAdminInvite);

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => list() as Promise<Invite[]>,
  });

  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          label: label.trim() || undefined,
          expires_days: expiresDays,
          max_uses: maxUses,
        },
      }) as Promise<Invite>,
    onSuccess: async (row) => {
      setLabel("");
      await qc.invalidateQueries({ queryKey: ["admin-invites"] });
      try {
        await navigator.clipboard.writeText(inviteUrl(row.token));
        toast.success("Invite link created and copied to clipboard.");
      } catch {
        toast.success("Invite link created.");
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to create invite."),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-invites"] });
      toast.success("Invite revoked.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to revoke invite."),
  });

  const sorted = useMemo(
    () => [...invites].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [invites],
  );

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy — copy the URL manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="surface-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" aria-hidden />
          <h2 className="text-sm font-semibold">Create admin invite link</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Share this link with someone you want to grant admin access. They sign in (or create an account),
          open the link, and are promoted to admin. Links expire and have a use limit.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="invite-label" className="text-xs">Label (optional)</Label>
            <Input
              id="invite-label"
              placeholder="e.g. Jamie — ops lead"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-expires" className="text-xs">Expires (days)</Label>
            <Input
              id="invite-expires"
              type="number"
              min={1}
              max={90}
              value={expiresDays}
              onChange={(e) => setExpiresDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-uses" className="text-xs">Max uses</Label>
            <Input
              id="invite-uses"
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            />
          </div>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="h-10"
          >
            <LinkIcon className="size-4 mr-1.5" />
            {createMut.isPending ? "Creating…" : "Create link"}
          </Button>
        </div>
      </div>

      <div className="surface-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Invite links</h2>
          <span className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${sorted.length} total`}
          </span>
        </div>
        {sorted.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No invite links yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((inv) => {
              const status = statusOf(inv);
              const active = status.tone === "ok";
              return (
                <li key={inv.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">
                        {inv.label || "Untitled invite"}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          status.tone === "ok"
                            ? "bg-gold/15 text-gold"
                            : status.tone === "warn"
                              ? "bg-amber-500/15 text-amber-600"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {inv.uses}/{inv.max_uses} used · expires{" "}
                      {new Date(inv.expires_at).toLocaleDateString(undefined, {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </div>
                  </div>
                  {active && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyLink(inv.token)}
                      className="h-8"
                    >
                      <Copy className="size-3.5 mr-1.5" /> Copy link
                    </Button>
                  )}
                  {!inv.revoked_at && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Revoke this invite link? Anyone holding it won't be able to redeem it.")) {
                          revokeMut.mutate(inv.id);
                        }
                      }}
                      disabled={revokeMut.isPending}
                      className="h-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5 mr-1.5" /> Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
