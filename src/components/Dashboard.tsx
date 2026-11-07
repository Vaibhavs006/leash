"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type State } from "./api";
import { AgentConsole } from "./AgentConsole";
import { ApprovalQueue } from "./ApprovalQueue";
import { Ledger } from "./Ledger";
import { MandatePanel } from "./MandatePanel";
import { Badge, Button, Logo, Spinner, cx } from "./ui";

export interface Toast {
  tone: "green" | "red" | "amber";
  text: string;
}

const MISSING_HELP: Record<string, string> = {
  paypal: "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET",
  anthropic: "ANTHROPIC_API_KEY",
  channel3: "CHANNEL3_API_KEY",
};

export function Dashboard({ initialNotice, initialState }: { initialNotice: Toast | null; initialState: State | null }) {
  const [state, setState] = useState<State | null>(initialState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(initialNotice);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Drop PayPal redirect params from the address bar (the notice was read on the server).
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/");
  }, []);

  // Keep the dashboard live while anything is in flight.
  const hasInFlight =
    !!activeRunId ||
    !!state?.runs.some((r) => r.status === "running") ||
    !!state?.purchases.some((p) => p.status === "processing" || p.status === "awaiting_payer");
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0); // initial load / immediate refresh on mode change
    const t = setInterval(() => void refresh(), hasInFlight ? 2000 : 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [hasInFlight, refresh]);

  const act = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      try {
        await fn();
      } catch (e) {
        const msg = e instanceof ApiError && e.missing ? `${e.message}` : e instanceof Error ? e.message : String(e);
        notify({ tone: "red", text: msg });
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [notify, refresh],
  );

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {loadError ? (
          <div className="card max-w-md p-6 text-center">
            <p className="font-medium text-slate-900">Leash could not load</p>
            <p className="mt-1 text-slate-500">{loadError}</p>
            <Button className="mt-4" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : (
          <Spinner className="h-5 w-5 text-slate-400" />
        )}
      </div>
    );
  }

  const missing = (["paypal", "anthropic", "channel3"] as const).filter((k) => !state.integrations[k]);
  const mandate = state.mandates.find((m) => m.status !== "revoked") ?? state.mandates[0];
  const pending = state.purchases.filter((p) => p.status === "pending_approval" || p.status === "awaiting_payer");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight">Leash</span>
              <Badge tone="violet">Sandbox</Badge>
            </div>
            <p className="hidden truncate text-xs text-slate-500 sm:block">Spending controls for AI purchasing agents · {state.workspace.businessName}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <WalletPill state={state} busy={busy} act={act} />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm("Reset this demo workspace? This clears your mandates, agent runs and ledger (sandbox data only). Your saved PayPal wallet is kept.")) return;
                void act("reset", async () => {
                  await api("/api/demo/reset", { method: "POST" });
                  setActiveRunId(null);
                  notify({ tone: "green", text: "Demo reset." });
                });
              }}
            >
              Reset<span className="hidden sm:inline">&nbsp;demo</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {missing.length > 0 && (
          <div className="card border-amber-200 bg-amber-50/60 px-5 py-3 text-sm text-amber-900">
            <span className="font-medium">Setup incomplete.</span> Missing {missing.map((m) => MISSING_HELP[m]).join(", ")}. Live agent runs and payments are disabled until
            these are set; the policy engine, ledger and the hijack simulation still work.
          </div>
        )}

        <Hero />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="space-y-5">
            {mandate && <MandatePanel mandate={mandate} busy={busy} act={act} notify={notify} />}
            <ApprovalQueue purchases={pending} busy={busy} act={act} walletConnected={state.workspace.walletConnected} />
          </div>
          <AgentConsole
            state={state}
            mandate={mandate}
            activeRunId={activeRunId}
            setActiveRunId={setActiveRunId}
            busy={busy}
            act={act}
            onRunSettled={refresh}
          />
        </div>

        <Ledger purchases={state.purchases} busy={busy} act={act} />

        <footer className="pb-8 pt-2 text-center text-xs text-slate-400">
          Sandbox demo. Leash acts as merchant of record in the PayPal sandbox; no real orders are placed with retailers. Product data from Channel3.
        </footer>
      </main>

      {toast && (
        <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div
            role="status"
            className={cx(
              "animate-in max-w-xl rounded-xl px-4 py-3 text-sm shadow-lg ring-1",
              toast.tone === "green" && "bg-emerald-900 text-emerald-50 ring-emerald-700",
              toast.tone === "red" && "bg-rose-900 text-rose-50 ring-rose-700",
              toast.tone === "amber" && "bg-amber-900 text-amber-50 ring-amber-700",
            )}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

function Hero() {
  return (
    <section className="card overflow-hidden">
      <div className="grid gap-4 bg-gradient-to-br from-white via-white to-teal-50/70 p-5 sm:grid-cols-3 sm:p-6">
        {[
          { k: "1", t: "You set a mandate", d: "Budget, caps, categories and blocked merchants, written once." },
          { k: "2", t: "The agent shops", d: "Claude searches real products and proposes carts. It never touches payment credentials." },
          { k: "3", t: "Leash decides, PayPal pays", d: "Small in-policy carts charge your saved wallet. Bigger ones need your approval on PayPal. Everything else is blocked." },
        ].map((s) => (
          <div key={s.k} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{s.k}</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{s.t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WalletPill({ state, busy, act }: { state: State; busy: string | null; act: (k: string, fn: () => Promise<void>) => Promise<void> }) {
  if (state.workspace.walletConnected) {
    return (
      <div className="hidden items-center gap-2 sm:flex">
        <Badge tone="green">● PayPal wallet saved{state.workspace.payerEmail ? ` · ${state.workspace.payerEmail}` : ""}</Badge>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => {
            if (!confirm("Remove the saved PayPal wallet? Agent purchases will then all need approval on PayPal.")) return;
            void act("wallet", async () => {
              await api("/api/wallet/disconnect", { method: "POST" });
            });
          }}
        >
          Remove
        </Button>
      </div>
    );
  }
  return (
    <Button
      variant="paypal"
      size="sm"
      disabled={busy !== null || !state.integrations.paypal}
      title={state.integrations.paypal ? "Save a PayPal wallet the agent can charge within your mandate" : "PayPal is not configured"}
      onClick={() =>
        void act("wallet", async () => {
          const { approveUrl } = await api<{ approveUrl: string }>("/api/wallet/connect", { method: "POST" });
          window.location.href = approveUrl;
        })
      }
    >
      {busy === "wallet" ? <Spinner /> : null}
      <span className="sm:hidden">Connect PayPal</span>
      <span className="hidden sm:inline">Connect PayPal wallet</span>
    </Button>
  );
}
