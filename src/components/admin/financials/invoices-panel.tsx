import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DollarSign, Plus } from "lucide-react";
import { toast } from "sonner";

export function InvoicesPanel() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);

  const clientsQ = useQuery({
    queryKey: ["clients-lookup-billing"],
    queryFn: async () => ((await (supabase as any).rpc("admin_list_clients_with_billing")).data ?? []) as Array<{id:string;name:string;bill_rate_cents:number|null;bill_currency:string;archived:boolean}>,
  });

  const invQ = useQuery({
    queryKey: ["invoices-list", statusFilter],
    queryFn: async () => {
      let req: any = (supabase as any).from("invoices").select("id,number,client_id,period_start,period_end,total_cents,currency,status,issued_at,created_at").order("created_at", { ascending: false });
      if (statusFilter !== "all") req = req.eq("status", statusFilter);
      const { data } = await req;
      return (data ?? []) as Array<{id:string;number:string;client_id:string;period_start:string;period_end:string;total_cents:number;currency:string;status:string;issued_at:string|null;created_at:string}>;
    },
  });

  const clientMap = useMemo(() => new Map((clientsQ.data ?? []).map(c => [c.id, c])), [clientsQ.data]);
  const rows = invQ.data ?? [];

  return (
    <div className="space-y-6">
      <header className="surface-card relative overflow-hidden rounded-xl px-4 py-2.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-2 min-w-0">
            <DollarSign className="size-3.5 text-gold/90 shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">Invoices</span>
            <span className="text-xs text-muted-foreground truncate hidden md:inline">· Bill your brands</span>
          </div>
          <div className="inline-flex items-center gap-2 ml-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setOpenNew(true)} className="press h-8"><Plus className="size-3.5 mr-1.5" />New invoice</Button>
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<DollarSign />}
          eyebrow="No invoices yet"
          title="Generate your first invoice."
          description="Pick a brand and a period — ClockWork rolls up billable hours per member into draft line items you can edit before sending."
          action={
            <Button onClick={() => setOpenNew(true)} className="press">
              <Plus className="size-4 mr-1.5" />New invoice
            </Button>
          }
        />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="py-2.5 px-4">Number</th>
                  <th className="py-2.5 px-4">Brand</th>
                  <th className="py-2.5 px-4">Period</th>
                  <th className="py-2.5 px-4 text-right">Total</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2.5 px-4 font-medium tabular-nums">{r.number}</td>
                    <td className="py-2.5 px-4">{clientMap.get(r.client_id)?.name ?? "—"}</td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{r.period_start} → {r.period_end}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{new Intl.NumberFormat(undefined, { style: "currency", currency: r.currency || "USD" }).format((r.total_cents ?? 0) / 100)}</td>
                    <td className="py-2.5 px-4"><span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${r.status === "paid" ? "bg-emerald-500/15 text-emerald-600" : r.status === "sent" ? "bg-blue-500/15 text-blue-600" : "bg-muted text-muted-foreground"}`}>{r.status}</span></td>
                    <td className="py-2.5 px-4 text-right"><Link to="/admin/invoices/$invoiceId" params={{ invoiceId: r.id }} className="text-xs text-primary hover:underline">Open →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewInvoiceDialog open={openNew} onOpenChange={setOpenNew} clients={(clientsQ.data ?? []).filter(c => !c.archived && (c.bill_rate_cents ?? 0) > 0)} onCreated={() => qc.invalidateQueries({ queryKey: ["invoices-list"] })} />
    </div>
  );
}

function NewInvoiceDialog({ open, onOpenChange, clients, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clients: Array<{ id: string; name: string; bill_rate_cents: number | null; bill_currency: string }>;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const [clientId, setClientId] = useState<string>("");
  const [start, setStart] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Array<{ va_id: string; name: string; hours: number; rate_cents: number; amount_cents: number }>>([]);
  const [unattributedSec, setUnattributedSec] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const client = useMemo(() => clients.find(c => c.id === clientId), [clientId, clients]);

  async function loadPreview() {
    if (!clientId) return;
    setLoadingPreview(true);
    try {
      const rate = client?.bill_rate_cents ?? 0;
      const { data, error } = await (supabase as any).rpc("admin_invoice_preview", {
        p_client_id: clientId,
        p_period_start: start,
        p_period_end: end,
        p_rate_cents: rate,
      });
      if (error) throw error;

      const rows: Array<{ va_id: string; name: string; hours: number; rate_cents: number; amount_cents: number }> = [];
      let unattributed = 0;
      for (const r of (data ?? []) as Array<{ va_id: string | null; va_name: string; active_sec: number; hours: number; amount_cents: number }>) {
        if (r.va_id === null) {
          unattributed = r.active_sec;
        } else {
          rows.push({
            va_id: r.va_id,
            name: r.va_name,
            hours: Number(r.hours),
            rate_cents: rate,
            amount_cents: r.amount_cents,
          });
        }
      }
      setPreview(rows);
      setUnattributedSec(unattributed);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to compute preview");
    } finally { setLoadingPreview(false); }
  }

  useEffect(() => { if (open && clientId) loadPreview(); /* eslint-disable-next-line */ }, [open, clientId, start, end]);

  const subtotal = preview.reduce((a, r) => a + r.amount_cents, 0);

  async function create() {
    if (!clientId || !client) { toast.error("Pick a client"); return; }
    setBusy(true);
    try {
      const { data: numData, error: numErr } = await (supabase as any).rpc("next_invoice_number");
      if (numErr) throw numErr;
      const number = numData as string;
      const { data: user } = await supabase.auth.getUser();
      const { data: inv, error: insErr } = await (supabase as any).from("invoices").insert({
        client_id: clientId,
        number,
        period_start: start,
        period_end: end,
        status: "draft",
        currency: client.bill_currency ?? "USD",
        subtotal_cents: subtotal,
        total_cents: subtotal,
        created_by: user.user?.id ?? null,
      }).select("id").single();
      if (insErr) throw insErr;
      if (preview.length) {
        const lines = preview.map((r, i) => ({
          invoice_id: inv.id,
          description: `${r.name} — ${r.hours.toFixed(2)}h`,
          va_id: r.va_id,
          hours: r.hours,
          rate_cents: r.rate_cents,
          amount_cents: r.amount_cents,
          sort: i,
        }));
        const { error: lErr } = await (supabase as any).from("invoice_line_items").insert(lines);
        if (lErr) throw lErr;
      }
      toast.success(`Created ${number}`);
      onOpenChange(false);
      onCreated();
      navigate({ to: "/admin/invoices/$invoiceId", params: { invoiceId: inv.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs">Brand</Label>
              <Select value={clientId} onValueChange={setClientId} disabled={clients.length === 0}>
                <SelectTrigger className="h-9"><SelectValue placeholder={clients.length === 0 ? "No billable brands" : "Pick a brand"} /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {clients.length === 0
                  ? "No brands have a bill rate yet — set a rate on a brand card in Team to invoice it."
                  : "Only brands with a bill rate appear here. Set a rate on the brand card in Team to invoice another."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground border-b border-border bg-muted/30">
              Preview · per-brand work segments (break + idle excluded)
            </div>
            {loadingPreview ? <div className="p-4 text-sm text-muted-foreground">Computing…</div> : preview.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{clientId ? "No billable time for this brand in the selected range." : "Pick a brand to preview."}</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground"><th className="py-2 px-3">Member</th><th className="py-2 px-3 text-right">Hours</th><th className="py-2 px-3 text-right">Rate</th><th className="py-2 px-3 text-right">Amount</th></tr></thead>
                <tbody>
                  {preview.map(r => (
                    <tr key={r.va_id} className="border-t border-border/40">
                      <td className="py-1.5 px-3">{r.name}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{r.hours.toFixed(2)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{new Intl.NumberFormat(undefined, { style: "currency", currency: client?.bill_currency || "USD" }).format(r.rate_cents / 100)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums font-medium">{new Intl.NumberFormat(undefined, { style: "currency", currency: client?.bill_currency || "USD" }).format(r.amount_cents / 100)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/20"><td colSpan={3} className="py-2 px-3 text-right text-xs uppercase tracking-wider text-muted-foreground">Subtotal</td><td className="py-2 px-3 text-right tabular-nums font-medium">{new Intl.NumberFormat(undefined, { style: "currency", currency: client?.bill_currency || "USD" }).format(subtotal / 100)}</td></tr>
                </tbody>
              </table>
            )}
            {unattributedSec > 0 && (
              <div className="px-3 py-2 text-xs border-t border-border bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <span className="font-medium">Unattributed:</span>
                <span>
                  {(unattributedSec / 3600).toFixed(2)} h ({unattributedSec}s) of work by these members in the period has no brand tag — not billed. Assign a brand on those segments to include them.
                </span>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={busy || !clientId}>{busy ? "Creating…" : "Save draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
