"use client";

import { api, type PurchaseView } from "./api";
import { timeAgo, usd } from "./format";
import { Badge, Button, SectionTitle, Spinner } from "./ui";

type Act = (k: string, fn: () => Promise<void>) => Promise<void>;

export function ApprovalQueue({ purchases, busy, act, walletConnected }: { purchases: PurchaseView[]; busy: string | null; act: Act; walletConnected: boolean }) {
  return (
    <section className="card">
      <SectionTitle
        title="Needs your approval"
        hint="Within the hard limits, but over what the agent may spend alone"
        right={purchases.length ? <Badge tone="amber">{purchases.length}</Badge> : null}
      />
      <div className="space-y-3 px-5 pb-5">
        {purchases.length === 0 && <p className="text-xs text-slate-500">Nothing waiting. Purchases over the auto-pay limit will appear here.</p>}
        {purchases.map((p) => (
          <div key={p.id} className="animate-in rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {p.items.map((i) => (
                  <p key={i.productId} className="truncate text-sm font-medium text-slate-900" title={i.title}>
                    {i.quantity} × {i.title}
                  </p>
                ))}
                <p className="text-[11px] text-slate-500" suppressHydrationWarning>
                  {[...new Set(p.items.map((i) => i.merchant))].join(", ")} · {timeAgo(p.createdAt)}
                </p>
              </div>
              <span className="shrink-0 text-base font-semibold tabular-nums">{usd(p.totalCents)}</span>
            </div>
            <p className="mt-2 text-xs italic text-slate-600">“{p.agentReason}”</p>
            <ul className="mt-1.5 text-[11px] text-amber-800">
              {p.reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
            {p.error && <p className="mt-1 text-[11px] text-rose-700">Last attempt: {p.error}</p>}
            <div className="mt-3 flex gap-2">
              {p.status === "awaiting_payer" ? (
                <>
                  <Badge tone="blue">
                    <Spinner className="h-3 w-3" /> Waiting for {p.simulated ? "simulated" : "PayPal"} approval
                  </Badge>
                  {p.paypalApproveUrl && (
                    <a href={p.paypalApproveUrl} className="text-xs font-medium text-teal-700 underline">
                      Continue
                    </a>
                  )}
                </>
              ) : (
                <Button
                  variant={p.simulated ? "primary" : "paypal"}
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`approve:${p.id}`, async () => {
                      const r = await api<{ approveUrl: string | null; purchase: PurchaseView }>(`/api/purchases/${p.id}/approve`, { method: "POST" });
                      if (r.approveUrl) window.location.href = r.approveUrl;
                      else if (r.purchase.status === "denied") throw new Error(`No longer allowed: ${r.purchase.reasons.join("; ")}`);
                      else if (r.purchase.error) throw new Error(r.purchase.error);
                    })
                  }
                >
                  {busy === `approve:${p.id}` ? <Spinner /> : null}
                  {p.simulated ? "Approve (simulated payment)" : <>Approve &amp; pay with PayPal</>}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void act(`reject:${p.id}`, async () => void (await api(`/api/purchases/${p.id}/reject`, { method: "POST" })))}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
        {!walletConnected && (
          <p className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
            No wallet saved yet, so every purchase needs approval. Connect a wallet (top right) to let in-policy purchases go through automatically.
          </p>
        )}
      </div>
    </section>
  );
}
