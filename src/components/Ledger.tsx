"use client";

import { Fragment, useState } from "react";
import type { PurchaseStatus } from "@/db/schema";
import { api, type PurchaseView } from "./api";
import { RULE_LABELS, timeAgo, usd } from "./format";
import { Badge, Button, SectionTitle, cx, type Tone } from "./ui";

type Act = (k: string, fn: () => Promise<void>) => Promise<void>;

const STATUS: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  captured: { label: "Paid", tone: "green" },
  processing: { label: "Processing", tone: "blue" },
  pending_approval: { label: "Awaiting you", tone: "amber" },
  awaiting_payer: { label: "On PayPal", tone: "blue" },
  denied: { label: "Blocked", tone: "red" },
  rejected: { label: "Rejected", tone: "gray" },
  failed: { label: "Failed", tone: "red" },
  refunded: { label: "Refunded", tone: "violet" },
};

const MODE: Record<string, string> = { vault: "Auto · saved wallet", buyer_approval: "Approved on PayPal" };

export function Ledger({ purchases, busy, act }: { purchases: PurchaseView[]; busy: string | null; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "paid" | "blocked">("all");
  const rows = purchases.filter((p) => (filter === "all" ? true : filter === "paid" ? p.status === "captured" || p.status === "refunded" : p.status === "denied"));
  const paid = purchases.filter((p) => p.status === "captured").reduce((s, p) => s + p.totalCents - p.refundedCents, 0);
  const blocked = purchases.filter((p) => p.status === "denied");

  return (
    <section className="card">
      <SectionTitle
        title="Audit ledger"
        hint="Every request the agent made, the rule trace behind each decision, and the PayPal record"
        right={
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5 text-xs">
            {(["all", "paid", "blocked"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx("rounded-lg px-2.5 py-1 capitalize", filter === f ? "bg-white font-medium shadow-sm" : "text-slate-500")}>
                {f}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-3 gap-3 px-5 pb-4">
        <Stat label="Paid via PayPal" value={usd(paid)} />
        <Stat label="Requests" value={String(purchases.length)} />
        <Stat label="Blocked by policy" value={`${blocked.length} · ${usd(blocked.reduce((s, p) => s + p.totalCents, 0))}`} tone="red" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-y border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Items</th>
              <th className="px-3 py-2 font-medium">Merchant</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">PayPal</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-xs text-slate-500">
                  No purchases yet.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const s = STATUS[p.status];
              const expanded = open === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className={cx("border-b border-slate-100 align-top hover:bg-slate-50/60", expanded && "bg-slate-50/60")}>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{timeAgo(p.createdAt)}</td>
                    <td className="max-w-[280px] px-3 py-3">
                      {p.items.length === 0 && <span className="text-xs text-slate-400">—</span>}
                      {p.items.map((i) => (
                        <p key={i.productId} className="truncate text-[13px] text-slate-800" title={i.title}>
                          {i.quantity} × {i.title}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{[...new Set(p.items.map((i) => i.merchant))].join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                      {usd(p.totalCents)}
                      {p.refundedCents > 0 && <p className="text-[11px] font-normal text-violet-700">−{usd(p.refundedCents)} refunded</p>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {p.paymentMode && <p className="mt-1 text-[11px] text-slate-400">{MODE[p.paymentMode]}</p>}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                      {p.paypalOrderId ? <p title="Order ID">{p.paypalOrderId}</p> : <span className="font-sans text-slate-400">{p.status === "denied" ? "never called" : "—"}</span>}
                      {p.paypalCaptureId && <p title="Capture ID" className="text-slate-400">cap {p.paypalCaptureId}</p>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(expanded ? null : p.id)} aria-expanded={expanded}>
                        {expanded ? "Hide" : "Why?"}
                      </Button>
                      {p.status === "captured" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => {
                            if (!confirm(`Refund ${usd(p.totalCents)} to the PayPal buyer (sandbox)?`)) return;
                            void act(`refund:${p.id}`, async () => void (await api(`/api/purchases/${p.id}/refund`, { method: "POST" })));
                          }}
                        >
                          Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={7} className="px-5 pb-4">
                        <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Agent&apos;s reason</p>
                            <p className="mt-1 text-sm italic text-slate-700">“{p.agentReason}”</p>
                            {p.error && (
                              <p className="mt-2 text-xs text-rose-700">
                                {p.error}
                                {p.paypalDebugId && <span className="ml-1 font-mono">(debug_id {p.paypalDebugId})</span>}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Policy trace ({p.checks.length} checks)</p>
                            <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                              {p.checks.map((c, i) => (
                                <li key={i} className={cx("flex gap-1.5", c.passed ? "text-slate-500" : c.severity === "deny" ? "text-rose-700" : "text-amber-800")}>
                                  <span aria-hidden>{c.passed ? "✓" : c.severity === "deny" ? "✕" : "↗"}</span>
                                  <span>
                                    <span className="font-medium">{RULE_LABELS[c.rule] ?? c.rule}</span>
                                    <span className="text-slate-400"> · {c.detail}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cx("mt-0.5 text-base font-semibold tabular-nums", tone === "red" && "text-rose-700")}>{value}</p>
    </div>
  );
}
