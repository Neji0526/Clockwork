import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Printer, Download, ArrowLeft } from "lucide-react";
import { fmtMoney, statusBadgeClass } from "@/lib/invoicing";

export const Route = createFileRoute("/admin_/invoices/$invoiceId")({
  head: () => ({ meta: [{ title: "Invoice — ClockWork" }] }),
  component: () => (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  ),
});

function Gate() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return <AppShell><p className="text-sm text-muted-foreground">Admin only.</p></AppShell>;
  }
  return <AppShell><InvoiceDetail /></AppShell>;
}

type LineItem = {
  id: string;
  invoice_id: string;
  description: string;
  va_id: string | null;
  hours: number;
  rate_cents: number;
  amount_cents: number;
  sort: number;
};

function InvoiceDetail() {
  const { invoiceId } = Route.useParams();
  const qc = useQueryClient();

  const invQ = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linesQ = useQuery({
    queryKey: ["invoice-lines", invoiceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("sort");
      if (error) throw error;
      return (data ?? []) as LineItem[];
    },
  });

  const clientQ = useQuery({
    queryKey: ["invoice-client", invQ.data?.client_id],
    enabled: !!invQ.data?.client_id,
    queryFn: async () => {
      // Read billing columns via the admin RPC (bill_rate_cents / bill_currency
      // are not selectable directly by the authenticated role — admin-only).
      const { data } = await (supabase as any).rpc("admin_list_clients_with_billing");
      const rows = (Array.isArray(data) ? data : []) as Array<{
        id: string; name: string; bill_rate_cents: number | null; bill_currency: string;
      }>;
      return rows.find((r) => r.id === invQ.data!.client_id) ?? null;
    },
  });

  const billingQ = useQuery({
    queryKey: ["billing-identity"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("admin_get_billing_config");
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");
  const [number, setNumber] = useState("");
  const [issued, setIssued] = useState("");
  const [due, setDue] = useState("");

  useEffect(() => {
    if (linesQ.data) setLines(linesQ.data);
  }, [linesQ.data]);
  useEffect(() => {
    if (invQ.data) {
      setNotes(invQ.data.notes ?? "");
      setNumber(invQ.data.number ?? "");
      setIssued(invQ.data.issued_at ?? "");
      setDue(invQ.data.due_date ?? "");
    }
  }, [invQ.data]);

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + (l.amount_cents ?? 0), 0),
    [lines],
  );

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setLines((prev) => {
      const next = [...prev];
      const merged = { ...next[idx], ...patch };
      const hours = Number(merged.hours) || 0;
      const rate = Number(merged.rate_cents) || 0;
      merged.amount_cents = Math.round(hours * rate);
      next[idx] = merged;
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        invoice_id: invoiceId,
        description: "",
        va_id: null,
        hours: 0,
        rate_cents: clientQ.data?.bill_rate_cents ?? 0,
        amount_cents: 0,
        sort: prev.length,
      },
    ]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!invQ.data?.updated_at) {
      toast.error("Invoice not loaded yet — try again in a moment.");
      return;
    }
    // Single RPC = single transaction. The old code did delete → insert → update
    // as three separate writes; a failure between the delete and the insert wiped
    // every line item with no rollback. The RPC also enforces an optimistic-
    // concurrency check on updated_at so two admins can't silently overwrite
    // each other.
    // Subtotal and total are computed server-side from the lines below; the
    // RPC ignores any client-supplied totals. Each line's rate_cents is sent
    // verbatim and never re-pulled from the client's current bill rate, so
    // existing lines preserve the rate they were issued at.
    const { data, error } = await (supabase as any).rpc("admin_save_invoice", {
      p_invoice_id: invoiceId,
      p_expected_updated_at: invQ.data.updated_at,
      p_number: number,
      p_notes: notes,
      p_issued_at: issued || null,
      p_due_date: due || null,
      p_lines: lines.map((l, i) => ({
        description: l.description || "",
        va_id: l.va_id,
        hours: Number(l.hours) || 0,
        rate_cents: Math.round(Number(l.rate_cents) || 0),
        sort: i,
      })),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.ok) {
      if (data?.reason === "conflict") {
        toast.error(
          "This invoice was changed by someone else since you opened it. Reload to see the latest version, then re-apply your edits.",
          { duration: 8000 },
        );
        qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
        qc.invalidateQueries({ queryKey: ["invoice-lines", invoiceId] });
      } else if (data?.reason === "not_found") {
        toast.error("This invoice no longer exists.");
      } else {
        toast.error(data?.reason ?? "Save failed");
      }
      return;
    }
    toast.success("Invoice saved");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoice-lines", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices-list"] });
  }

  async function setStatus(next: "draft" | "sent" | "paid") {
    const patch: any = { status: next };
    if (next === "sent" && !invQ.data?.issued_at) patch.issued_at = new Date().toISOString().slice(0, 10);
    const { error } = await (supabase as any).from("invoices").update(patch).eq("id", invoiceId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${next}`);
    qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices-list"] });
  }

  function exportCsv() {
    const headers = ["description", "va_id", "hours", "rate", "amount"];
    const rows = lines.map((l) => [
      JSON.stringify(l.description ?? ""),
      l.va_id ?? "",
      (Number(l.hours) || 0).toFixed(2),
      ((l.rate_cents ?? 0) / 100).toFixed(2),
      ((l.amount_cents ?? 0) / 100).toFixed(2),
    ].join(","));
    const csv = [headers.join(","), ...rows, `,,,subtotal,${(subtotal / 100).toFixed(2)}`].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invQ.data?.number ?? "invoice"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (invQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!invQ.data) return <p className="text-sm text-muted-foreground">Invoice not found.</p>;

  const inv = invQ.data;
  const currency = inv.currency ?? "USD";
  const biz = billingQ.data ?? {};

  return (
    <div className="space-y-6">
      {/* Print stylesheet: hide app chrome and edit controls */}
      <style>{`
        @media print {
          body { background: white !important; }
          header, nav, aside, .no-print { display: none !important; }
          .invoice-print, .invoice-print * { visibility: visible; }
          .invoice-print { position: absolute; inset: 0; padding: 24px; color: #000 !important; }
          .invoice-print .surface-card { box-shadow: none !important; border: 1px solid #e5e5e5 !important; background: white !important; }
        }
      `}</style>

      {/* Toolbar (hidden in print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link to="/financials" className="text-sm text-muted-foreground inline-flex items-center gap-1.5 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to invoices
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded-full text-[11px] uppercase tracking-wider ${statusBadgeClass(inv.status)}`}>{inv.status}</span>
          <Select value={inv.status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-3.5 mr-1.5" />Print / PDF</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-3.5 mr-1.5" />CSV</Button>
          {!editing ? (
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setLines(linesQ.data ?? []); }}>Cancel</Button>
              <Button size="sm" onClick={save}>Save</Button>
            </>
          )}
        </div>
      </div>

      {/* Printable invoice */}
      <div className="invoice-print surface-card p-8 md:p-10 max-w-3xl mx-auto space-y-8">
        <div className="flex justify-between items-start gap-6">
          <div>
            {biz.billing_logo_url ? (
              <img src={biz.billing_logo_url} alt="" className="h-12 mb-3 object-contain" />
            ) : null}
            <div className="font-display text-2xl">{biz.billing_business_name ?? "Your Business"}</div>
            {biz.billing_address ? <div className="text-sm text-muted-foreground whitespace-pre-line">{biz.billing_address}</div> : null}
            {biz.billing_email ? <div className="text-sm text-muted-foreground">{biz.billing_email}</div> : null}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Invoice</div>
            {editing ? (
              <Input value={number} onChange={(e) => setNumber(e.target.value)} className="h-9 w-40 text-right font-display text-xl tabular-nums" />
            ) : (
              <div className="font-display text-2xl tabular-nums">{inv.number}</div>
            )}
            <div className="text-xs text-muted-foreground mt-2">Period</div>
            <div className="text-sm tabular-nums">{inv.period_start} → {inv.period_end}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Bill to</div>
            <div className="font-medium">{clientQ.data?.name ?? "—"}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Issued</div>
              {editing ? (
                <Input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className="h-8 text-xs" />
              ) : (
                <div className="tabular-nums">{inv.issued_at ?? "—"}</div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Due</div>
              {editing ? (
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 text-xs" />
              ) : (
                <div className="tabular-nums">{inv.due_date ?? "—"}</div>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 px-2 text-right w-24">Hours</th>
                <th className="py-2 px-2 text-right w-32">Rate</th>
                <th className="py-2 pl-2 text-right w-32">Amount</th>
                {editing && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={editing ? 5 : 4} className="py-6 text-center text-muted-foreground">No line items.</td></tr>
              )}
              {lines.map((l, i) => (
                <tr key={l.id} className="border-b border-border/40 align-top">
                  <td className="py-2 pr-3">
                    {editing ? (
                      <Input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="h-8" />
                    ) : (l.description || <span className="text-muted-foreground">—</span>)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {editing ? (
                      <Input type="number" step="0.01" value={l.hours}
                        onChange={(e) => updateLine(i, { hours: Number(e.target.value) })}
                        className="h-8 text-right" />
                    ) : (Number(l.hours) || 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {editing ? (
                      <Input type="number" step="0.01" value={(l.rate_cents / 100).toString()}
                        onChange={(e) => updateLine(i, { rate_cents: Math.round((Number(e.target.value) || 0) * 100) })}
                        className="h-8 text-right" />
                    ) : fmtMoney(l.rate_cents, currency)}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums font-medium">{fmtMoney(l.amount_cents, currency)}</td>
                  {editing && (
                    <td className="py-2 pl-2 text-right">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => removeLine(i)}><Trash2 className="size-3.5" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={editing ? 3 : 2} />
                <td className="pt-3 text-right text-xs uppercase tracking-[0.16em] text-muted-foreground">Subtotal</td>
                <td className="pt-3 pl-2 text-right tabular-nums">{fmtMoney(subtotal, currency)}</td>
                {editing && <td />}
              </tr>
              <tr>
                <td colSpan={editing ? 3 : 2} />
                <td className="pt-1 text-right text-xs uppercase tracking-[0.16em] text-muted-foreground">Total</td>
                <td className="pt-1 pl-2 text-right tabular-nums font-display text-lg">{fmtMoney(subtotal, currency)}</td>
                {editing && <td />}
              </tr>
            </tfoot>
          </table>
          {editing && (
            <Button variant="outline" size="sm" className="mt-3" onClick={addLine}>
              <Plus className="size-3.5 mr-1.5" />Add line
            </Button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-6 text-sm">
          <div>
            <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Notes</Label>
            {editing ? (
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="mt-1" />
            ) : (
              <div className="mt-1 whitespace-pre-line text-muted-foreground">{notes || "—"}</div>
            )}
          </div>
          {biz.billing_payment_notes && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Payment instructions</div>
              <div className="mt-1 whitespace-pre-line text-muted-foreground">{biz.billing_payment_notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
