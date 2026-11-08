"use client";

import { useState } from "react";
import { api, type MandateView } from "./api";
import type { Toast } from "./Dashboard";
import { daysUntil, usd } from "./format";
import { Badge, Button, SectionTitle, cx } from "./ui";

type Act = (k: string, fn: () => Promise<void>) => Promise<void>;

export function MandatePanel({ mandate: m, busy, act, notify }: { mandate: MandateView; busy: string | null; act: Act; notify: (t: Toast) => void }) {
  const [editing, setEditing] = useState(false);
  const spentPct = Math.min(100, (m.spentCents / m.budgetCents) * 100);
  const pendingPct = Math.min(100 - spentPct, (m.pendingCents / m.budgetCents) * 100);
  const remaining = Math.max(0, m.budgetCents - m.spentCents - m.pendingCents);
  const daysLeft = daysUntil(m.expiresAt);

  return (
    <section className="card">
      <SectionTitle
        title="Mandate"
        hint="The rules your agent cannot break"
        right={
          <Badge tone={m.status === "active" ? "green" : m.status === "paused" ? "amber" : "red"}>
            {m.status === "active" ? "● Active" : m.status === "paused" ? "Paused" : "Revoked"}
          </Badge>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <div>
          <p className="text-sm font-semibold text-slate-900">{m.name}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{m.purpose}</p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{usd(remaining)}</span>
            <span className="text-xs text-slate-500" suppressHydrationWarning>
              left of {usd(m.budgetCents)} · {daysLeft}d
            </span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${usd(m.spentCents)} spent, ${usd(m.pendingCents)} pending`}>
            <div className="bg-brand transition-all" style={{ width: `${spentPct}%` }} />
            <div className="bg-amber-400 transition-all" style={{ width: `${pendingPct}%` }} />
          </div>
          <div className="mt-1.5 flex gap-4 text-[11px] text-slate-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand" />Spent {usd(m.spentCents)}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Reserved {usd(m.pendingCents)}</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <Limit label="Auto-pay up to" value={usd(m.autoApproveLimitCents)} tone="green" />
          <Limit label="Hard cap per purchase" value={usd(m.perPurchaseCapCents)} tone="red" />
          <Limit label="Max units per item" value={String(m.maxItemQuantity)} />
          <Limit label="Expires" value={new Date(m.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })} />
        </dl>

        <ChipRow label="Allowed categories" items={m.allowedCategories} empty="Any category" />
        <ChipRow label="Blocked merchants" items={m.blockedMerchants} empty="None" tone="red" />
        {m.allowedMerchants.length > 0 && <ChipRow label="Allowed merchants only" items={m.allowedMerchants} empty="" />}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>
            Edit rules
          </Button>
          {m.status !== "revoked" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void act("mandate", async () => {
                  await api(`/api/mandates/${m.id}`, { method: "PATCH", body: JSON.stringify({ status: m.status === "active" ? "paused" : "active" }) });
                })
              }
            >
              {m.status === "active" ? "Pause agent" : "Resume"}
            </Button>
          )}
        </div>
      </div>
      {editing && <MandateEditor mandate={m} onClose={() => setEditing(false)} act={act} notify={notify} />}
    </section>
  );
}

function Limit({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={cx("mt-0.5 font-semibold tabular-nums", tone === "green" && "text-emerald-700", tone === "red" && "text-rose-700")} suppressHydrationWarning>
        {value}
      </dd>
    </div>
  );
}

function ChipRow({ label, items, empty, tone = "gray" }: { label: string; items: string[]; empty: string; tone?: "gray" | "red" }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.map((c) => <Badge key={c} tone={tone}>{c}</Badge>) : <span className="text-xs text-slate-500">{empty}</span>}
      </div>
    </div>
  );
}

const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const toCents = (s: string) => Math.round(Number(s) * 100);

function MandateEditor({ mandate: m, onClose, act, notify }: { mandate: MandateView; onClose: () => void; act: Act; notify: (t: Toast) => void }) {
  const [f, setF] = useState({
    name: m.name,
    purpose: m.purpose,
    budget: (m.budgetCents / 100).toString(),
    cap: (m.perPurchaseCapCents / 100).toString(),
    auto: (m.autoApproveLimitCents / 100).toString(),
    qty: String(m.maxItemQuantity),
    cats: m.allowedCategories.join(", "),
    blocked: m.blockedMerchants.join(", "),
    allowed: m.allowedMerchants.join(", "),
    days: String(Math.max(1, daysUntil(m.expiresAt))),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = () =>
    act("mandate", async () => {
      await api(`/api/mandates/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: f.name,
          purpose: f.purpose,
          budgetCents: toCents(f.budget),
          perPurchaseCapCents: toCents(f.cap),
          autoApproveLimitCents: toCents(f.auto),
          maxItemQuantity: Number(f.qty),
          allowedCategories: toList(f.cats),
          blockedMerchants: toList(f.blocked),
          allowedMerchants: toList(f.allowed),
          expiresInDays: Number(f.days),
        }),
      });
      notify({ tone: "green", text: "Mandate updated. New rules apply to the very next purchase request." });
      onClose();
    });

  const input = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-teal-100";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="card animate-in max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit mandate">
        <h3 className="text-base font-semibold">Edit mandate</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-medium text-slate-600">
          <label className="col-span-2">Name<input className={input} value={f.name} onChange={set("name")} /></label>
          <label className="col-span-2">Purpose (shown to the agent)<textarea className={input} rows={2} value={f.purpose} onChange={set("purpose")} /></label>
          <label>Total budget ($)<input className={input} inputMode="decimal" value={f.budget} onChange={set("budget")} /></label>
          <label>Expires in (days)<input className={input} inputMode="numeric" value={f.days} onChange={set("days")} /></label>
          <label>Auto-pay up to ($)<input className={input} inputMode="decimal" value={f.auto} onChange={set("auto")} /></label>
          <label>Hard cap per purchase ($)<input className={input} inputMode="decimal" value={f.cap} onChange={set("cap")} /></label>
          <label>Max units per item<input className={input} inputMode="numeric" value={f.qty} onChange={set("qty")} /></label>
          <span />
          <label className="col-span-2">Allowed categories (comma separated, empty = any)<input className={input} value={f.cats} onChange={set("cats")} /></label>
          <label className="col-span-2">Blocked merchants (domains)<input className={input} value={f.blocked} onChange={set("blocked")} /></label>
          <label className="col-span-2">Allowed merchants only (domains, empty = any)<input className={input} value={f.allowed} onChange={set("allowed")} /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()}>Save rules</Button>
        </div>
      </div>
    </div>
  );
}
