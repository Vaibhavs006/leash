import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { usd } from "@/components/format";
import { Logo } from "@/components/ui";
import { modes } from "@/lib/server/modes";
import { currentWorkspace } from "@/lib/server/session";

export const metadata = { title: "Leash payment simulator" };

/**
 * OFFLINE PAYMENT SIMULATOR. Stands in for the buyer-approval step only when PayPal
 * credentials are not configured. Deliberately Leash-branded and labelled; in live
 * mode this step happens on PayPal's own checkout page and this route returns nothing.
 */
async function Simulator({ searchParams }: { searchParams: PageProps<"/demo/approve">["searchParams"] }) {
  await connection();
  const q = await searchParams;
  const kind = q.kind === "wallet" ? "wallet" : "order";
  const purchaseId = typeof q.purchase === "string" ? q.purchase : "";
  const token = typeof q.token === "string" ? q.token : "";

  const paymentsMode = modes().payments;
  if (paymentsMode !== "simulated") {
    return (
      <Shell>
        <p className="text-sm text-slate-600">
          {paymentsMode === "live"
            ? "The payment simulator is disabled because live PayPal is configured."
            : "The payment simulator is disabled (DEMO_MODE=off) and PayPal is not configured."}
        </p>
      </Shell>
    );
  }

  if (kind === "wallet") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Save a wallet for agent purchases</h1>
        <p className="mt-2 text-sm text-slate-600">
          In live mode, this is where PayPal asks the buyer to save their PayPal wallet for future merchant-initiated payments (PayPal Vault). Approving here
          creates a <strong>simulated</strong> wallet token. No PayPal account or money is involved.
        </p>
        <Actions approve="/api/wallet/return" cancel="/?wallet=cancelled" approveLabel="Approve (simulated)" />
      </Shell>
    );
  }

  const ws = await currentWorkspace();
  const [p] = await db.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.workspaceId, ws.id)));
  if (!p || !p.simulated || p.status !== "awaiting_payer" || p.paypalOrderId !== token) {
    return <Shell><p className="text-sm text-slate-600">This approval link is no longer valid.</p><Link className="mt-4 inline-block text-sm text-teal-700 underline" href="/">Back to Leash</Link></Shell>;
  }
  const qs = new URLSearchParams({ purchase: p.id, token });
  return (
    <Shell>
      <h1 className="text-lg font-semibold">Approve purchase</h1>
      <p className="mt-1 text-sm text-slate-600">In live mode, the owner approves this payment on PayPal&apos;s checkout page. This simulator records the same approval without moving money.</p>
      <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {p.items.map((i) => (
          <li key={i.productId} className="flex justify-between gap-3 px-3 py-2 text-sm">
            <span className="truncate">{i.quantity} × {i.title}</span>
            <span className="tabular-nums text-slate-600">{usd(i.unitCents * i.quantity)}</span>
          </li>
        ))}
        <li className="flex justify-between px-3 py-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{usd(p.totalCents)}</span>
        </li>
      </ul>
      <p className="mt-2 font-mono text-[11px] text-slate-400">{token}</p>
      <Actions approve={`/api/paypal/return?${qs}`} cancel={`/api/paypal/cancel?purchase=${p.id}`} approveLabel={`Approve ${usd(p.totalCents)} (simulated)`} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span className="text-sm font-semibold">Leash</span>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Offline payment simulator</span>
        </div>
        {children}
      </div>
    </main>
  );
}

function Actions({ approve, cancel, approveLabel }: { approve: string; cancel: string; approveLabel: string }) {
  return (
    <div className="mt-5 flex gap-2">
      <a href={approve} className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-slate-800">
        {approveLabel}
      </a>
      <a href={cancel} className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
        Cancel
      </a>
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/demo/approve">) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Simulator searchParams={searchParams} />
    </Suspense>
  );
}
