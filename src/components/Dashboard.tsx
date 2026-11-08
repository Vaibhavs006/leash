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

const MODE_LABELS = {
  catalog: { live: "Channel3 live search", simulated: "Simulated catalog", unavailable: "Search unavailable" },
  agent: { live: "Claude", simulated: "Rule-based planner (no LLM)", unavailable: "Agent unavailable" },
  payments: { live: "PayPal sandbox", simulated: "Offline payment simulator", unavailable: "Payments unavailable" },
} as const;

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

  const mandate = state.mandates.find((m) => m.status !== "revoked") ?? state.mandates[0];
  const canLoadSample = state.modes.payments === "simulated" && state.purchases.length === 0 && state.runs.length === 0;
  const loadSample = canLoadSample
    ? () =>
        void act("sample", async () => {
          await api("/api/demo/sample", { method: "POST" });
          setActiveRunId(null);
          notify({ tone: "green", text: "Sample history loaded: 5 simulated agent runs through the real policy engine." });
        })
    : undefined;
  const pending = state.purchases.filter((p) => p.status === "pending_approval" || p.status === "awaiting_payer");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight">Leash</span>
              <span className="hidden sm:inline">
                {state.modes.payments === "live" ? <Badge tone="violet">PayPal Sandbox</Badge> : <Badge tone="amber">Offline demo</Badge>}
              </span>
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
                if (!confirm("Reset this demo workspace? This clears your mandates, agent runs and ledger (demo data only). Your saved wallet is kept.")) return;
                void act("reset", async () => {
                  await api("/api/demo/reset", { method: "POST" });
                  setActiveRunId(null);
                  notify({ tone: "green", text: "Demo reset. The default mandate is restored and the ledger is empty." });
                });
              }}
            >
              Reset<span className="hidden sm:inline">&nbsp;demo</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <ModeBanner state={state} />

        <Hero modes={state.modes} />

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
            loadSample={loadSample}
          />
        </div>

        <Ledger purchases={state.purchases} busy={busy} act={act} loadSample={loadSample} />

        <footer className="space-y-2 pb-8 pt-2 text-center text-xs text-slate-400">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span>Integrations:</span>
            {(["catalog", "agent", "payments"] as const).map((k) => (
              <Badge key={k} tone={state.modes[k] === "live" ? "green" : state.modes[k] === "simulated" ? "amber" : "red"}>
                {MODE_LABELS[k][state.modes[k]]}
              </Badge>
            ))}
          </div>
          <p>
            {state.modes.payments === "live"
              ? "PayPal sandbox: Leash acts as merchant of record; no real orders are placed with retailers."
              : "Offline demo: payments are simulated and no money moves."}{" "}
            {state.modes.catalog === "live" ? "Product data from Channel3." : "Products come from a simulated catalog (.example merchants)."}
          </p>
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

function Hero({ modes }: { modes: State["modes"] }) {
  const agent = modes.agent === "live" ? "Claude" : "The agent (offline: a rule-based planner)";
  const where = modes.catalog === "live" ? "real products" : "a simulated catalog";
  const pays = modes.payments === "live" ? "PayPal" : "the payment simulator";
  return (
    <section className="card overflow-hidden">
      <div className="grid gap-4 bg-gradient-to-br from-white via-white to-teal-50/70 p-5 sm:grid-cols-3 sm:p-6">
        {[
          { k: "1", t: "You set a mandate", d: "Budget, caps, categories and blocked merchants, written once." },
          { k: "2", t: "The agent shops", d: `${agent} searches ${where} and proposes carts. It never touches payment credentials.` },
          {
            k: "3",
            t: modes.payments === "live" ? "Leash decides, PayPal pays" : "Leash decides, then pays",
            d: `Small in-policy carts charge your saved wallet via ${pays}. Bigger ones need your approval. Everything else is blocked.`,
          },
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
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Visibility lives on wrappers: Badge's own inline-flex would override `hidden`. */}
        <span className="sm:hidden">
          <Badge tone="green">● Wallet</Badge>
        </span>
        <span className="hidden sm:inline">
          <Badge tone="green">
            ● {state.workspace.walletSimulated ? "Simulated wallet saved" : "PayPal wallet saved"}
            {state.workspace.payerEmail ? ` · ${state.workspace.payerEmail}` : ""}
          </Badge>
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => {
            if (!confirm("Remove the saved wallet? Agent purchases will then all need your approval.")) return;
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
      variant={state.modes.payments === "live" ? "paypal" : "secondary"}
      size="sm"
      disabled={busy !== null || state.modes.payments === "unavailable"}
      title={
        state.modes.payments === "live"
          ? "Save a PayPal wallet the agent can charge within your mandate"
          : state.modes.payments === "simulated"
            ? "Save a simulated wallet (offline demo, no PayPal, no money)"
            : "PayPal is not configured"
      }
      onClick={() =>
        void act("wallet", async () => {
          const { approveUrl } = await api<{ approveUrl: string }>("/api/wallet/connect", { method: "POST" });
          window.location.href = approveUrl;
        })
      }
    >
      {busy === "wallet" ? <Spinner /> : null}
      <span className="sm:hidden">{state.modes.payments === "live" ? "Connect PayPal" : "Connect wallet"}</span>
      <span className="hidden sm:inline">{state.modes.payments === "live" ? "Connect PayPal wallet" : "Connect wallet (simulated)"}</span>
    </Button>
  );
}

function ModeBanner({ state }: { state: State }) {
  const entries = (["catalog", "agent", "payments"] as const).map((k) => ({ k, mode: state.modes[k] }));
  const unavailable = entries.filter((e) => e.mode === "unavailable");
  const simulated = entries.filter((e) => e.mode === "simulated");
  if (!unavailable.length && !simulated.length) return null;
  return (
    <div className={cx("card px-5 py-3 text-sm", unavailable.length ? "border-rose-200 bg-rose-50/60 text-rose-900" : "border-amber-200 bg-amber-50/60 text-amber-900")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{unavailable.length ? "Setup incomplete." : "Offline demo mode."}</span>
        {entries.map(({ k, mode }) => (
          <Badge key={k} tone={mode === "live" ? "green" : mode === "simulated" ? "amber" : "red"}>
            {mode === "live" ? "● " : mode === "simulated" ? "◐ " : "✕ "}
            {MODE_LABELS[k][mode]}
          </Badge>
        ))}
      </div>
      <p className="mt-1 text-xs opacity-80">
        {unavailable.length
          ? "Some integrations are missing keys and DEMO_MODE=off, so those features are disabled. See README → Setup."
          : "Simulated parts are labelled everywhere and never call external APIs or move money. Add the API keys in .env.local to switch each part to live. See README → Setup."}
      </p>
    </div>
  );
}
