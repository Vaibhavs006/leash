"use client";

import { useEffect, useRef, useState } from "react";
import { api, type EventView, type MandateView, type RunView, type State } from "./api";
import { RULE_LABELS, timeAgo, usd } from "./format";
import { Badge, Button, SectionTitle, Spinner, cx } from "./ui";

type Act = (k: string, fn: () => Promise<void>) => Promise<void>;

const SUGGESTIONS = [
  "Restock espresso beans and oat milk for the week",
  "We're nearly out of 12oz hot cups and lids",
  "Buy a commercial espresso machine",
];

export function AgentConsole({
  state,
  mandate,
  activeRunId,
  setActiveRunId,
  busy,
  act,
  onRunSettled,
}: {
  state: State;
  mandate: MandateView | undefined;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  busy: string | null;
  act: Act;
  onRunSettled: () => void;
}) {
  const [goal, setGoal] = useState(SUGGESTIONS[0]);
  const [redTeam, setRedTeam] = useState(false);
  const available = state.modes.agent !== "unavailable" && state.modes.catalog !== "unavailable" && state.modes.payments !== "unavailable";
  const simAgent = state.modes.agent === "simulated";
  const shownRunId = activeRunId ?? state.runs[0]?.id ?? null;
  const running = state.runs.some((r) => r.status === "running");

  return (
    <section className="card flex min-h-[560px] flex-col">
      <SectionTitle
        title="Agent"
        hint={
          simAgent
            ? "Simulated rule-based planner (no LLM), with the same two tools Claude gets"
            : "Claude, with two tools: search products and request a purchase"
        }
        right={simAgent ? <Badge tone="amber">simulated agent</Badge> : <Badge tone="gray">{state.workspace.runsUsed} live runs used</Badge>}
      />
      <div className="space-y-3 px-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-teal-100">
          <textarea
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-slate-400"
            rows={2}
            value={goal}
            maxLength={500}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should the agent buy?"
            aria-label="Goal for the agent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setGoal(s)} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!mandate || busy !== null || running || goal.trim().length < 5 || !available}
            title={available ? undefined : "Some integrations are unavailable (missing keys with DEMO_MODE=off)"}
            onClick={() =>
              void act("run", async () => {
                const run = await api<RunView>("/api/runs", { method: "POST", body: JSON.stringify({ mandateId: mandate!.id, goal, redTeam }) });
                setActiveRunId(run.id);
              })
            }
          >
            {busy === "run" || running ? <Spinner /> : <span aria-hidden>▶</span>}
            Run agent
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={redTeam} onChange={(e) => setRedTeam(e.target.checked)} className="h-4 w-4 accent-rose-600" />
            {simAgent ? "Red-team: plant a malicious listing (the simulated agent will obey it)" : "Red-team: plant a malicious listing in search results"}
          </label>
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            disabled={!mandate || busy !== null || running}
            title="Submits exactly what a fully hijacked agent would. No LLM involved."
            onClick={() =>
              void act("hijack", async () => {
                const run = await api<RunView>("/api/demo/hijack", { method: "POST", body: JSON.stringify({ mandateId: mandate!.id }) });
                setActiveRunId(run.id);
              })
            }
          >
            Simulate hijacked agent
          </Button>
        </div>
      </div>

      <div className="mt-4 flex-1 border-t border-slate-100">
        {shownRunId ? (
          <RunTimeline key={shownRunId} runId={shownRunId} onSettled={onRunSettled} />
        ) : (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">No agent runs yet</p>
            <p className="max-w-sm text-xs text-slate-500">Give the agent a goal. Every search, cart and policy decision shows up here live.</p>
          </div>
        )}
      </div>

      {state.runs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-slate-100 px-5 py-3">
          {state.runs.slice(0, 8).map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveRunId(r.id)}
              className={cx(
                "max-w-[220px] shrink-0 truncate rounded-lg px-2.5 py-1 text-left text-[11px] ring-1",
                r.id === shownRunId ? "bg-ink text-white ring-ink" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
              title={r.goal}
            >
              {r.redTeam ? "⚠ " : ""}
              {r.goal}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface ProductLite {
  id: string;
  title: string;
  merchant: string;
  priceCents: number;
  imageUrl: string | null;
  injected?: boolean;
}

function RunTimeline({ runId, onSettled }: { runId: string; onSettled: () => void }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [events, setEvents] = useState<EventView[]>([]);
  const last = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<{ run: RunView; events: EventView[] }>(`/api/runs/${runId}?after=${last.current}`);
        if (stop) return;
        setRun(r.run);
        if (r.events.length) {
          last.current = r.events[r.events.length - 1].id;
          setEvents((prev) => [...prev, ...r.events]);
          onSettled();
        }
        if (r.run.status === "running") timer = setTimeout(poll, 900);
      } catch {
        if (!stop) timer = setTimeout(poll, 2500);
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId, onSettled]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length]);

  return (
    <div className="max-h-[520px] space-y-2.5 overflow-y-auto px-5 py-4">
      {run && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">Goal:</span>
          <span className="truncate">{run.goal}</span>
          <span className="ml-auto shrink-0">{timeAgo(run.createdAt)}</span>
          {run.status === "running" && <Badge tone="blue"><Spinner className="h-3 w-3" /> running</Badge>}
          {run.status === "failed" && <Badge tone="red">failed</Badge>}
        </div>
      )}
      {events.map((e) => (
        <EventRow key={e.id} e={e} />
      ))}
      <div ref={bottom} />
    </div>
  );
}

function EventRow({ e }: { e: EventView }) {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case "status":
      return (
        <Row icon="◎" tone="gray">
          <span className="text-slate-600">{String(d.message)}</span>
          {d.redTeam ? <Badge tone="red" className="ml-2">red-team</Badge> : null}
          {d.modes ? (
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {Object.entries(d.modes as Record<string, string>).map(([k, v]) => (
                <Badge key={k} tone={v === "live" ? "green" : "amber"}>
                  {k}: {v}
                </Badge>
              ))}
            </span>
          ) : null}
        </Row>
      );
    case "thinking":
      return (
        <Row icon="✦" tone="violet">
          <p className="text-slate-700">{String(d.text)}</p>
        </Row>
      );
    case "tool_call":
      if (d.tool === "search_products")
        return (
          <Row icon="⌕" tone="blue">
            <span className="text-slate-600">Searching catalog for </span>
            <span className="font-medium text-slate-900">“{String(d.query)}”</span>
          </Row>
        );
      return (
        <Row icon="🛒" tone="blue">
          <p className="text-slate-600">
            Agent requests a purchase: <span className="italic text-slate-800">“{String(d.reason)}”</span>
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {(d.items as Array<{ product_id: string; quantity: number; unit_price_usd: number }>).map((i) => (
              <li key={i.product_id} className="font-mono">
                {i.quantity} × {i.product_id} @ ${i.unit_price_usd.toFixed(2)} (claimed)
              </li>
            ))}
          </ul>
        </Row>
      );
    case "tool_result": {
      const products = (d.products as ProductLite[]) ?? [];
      return (
        <Row icon="▤" tone="gray">
          <p className="text-xs text-slate-500">{products.length} products found</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {products.slice(0, 8).map((p) => (
              <div key={p.id} className={cx("rounded-xl border p-2", p.injected ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white")}>
                <div className="flex h-14 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="text-lg text-slate-300">{p.injected ? "☠" : "□"}</span>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-slate-800">{p.title}</p>
                <p className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="truncate">{p.merchant}</span>
                  <span className="font-semibold text-slate-800">{usd(p.priceCents)}</span>
                </p>
                {p.injected && <Badge tone="red" className="mt-1">injected listing</Badge>}
              </div>
            ))}
          </div>
          {typeof d.injection === "string" && (
            <p className="mt-2 rounded-lg bg-rose-50 p-2 font-mono text-[11px] text-rose-800">Listing text: “{d.injection}”</p>
          )}
        </Row>
      );
    }
    case "policy": {
      const decision = String(d.decision);
      const failed = (d.failed as string[]) ?? [];
      const tone = decision === "AUTO_APPROVE" ? "green" : decision === "REQUIRE_APPROVAL" ? "amber" : "red";
      const label = decision === "AUTO_APPROVE" ? "Policy: approved automatically" : decision === "REQUIRE_APPROVAL" ? "Policy: needs your approval" : "Policy: blocked";
      return (
        <Row icon="⛨" tone={tone}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{label}</span>
            <Badge tone={tone}>{usd(Number(d.totalCents))} at catalog prices</Badge>
          </div>
          {failed.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {(d.reasons as string[]).map((r, i) => (
                <li key={i} className={tone === "red" ? "text-rose-700" : "text-amber-800"}>
                  ✕ {r}
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && <p className="mt-1 text-[11px] text-slate-400">Rules failed: {failed.map((f) => RULE_LABELS[f] ?? f).join(" · ")}</p>}
        </Row>
      );
    }
    case "payment":
      return d.status === "captured" ? (
        <Row icon="$" tone="green">
          <span className="font-medium text-emerald-800">
            {String(d.paypalOrderId ?? "").startsWith("SIM-") ? "Charged saved wallet (simulated, no money moved)" : "Charged saved PayPal wallet"}
          </span>
          <span className="ml-2 font-mono text-[11px] text-slate-500">order {String(d.paypalOrderId)}</span>
        </Row>
      ) : (
        <Row icon="!" tone="red">
          <span className="text-rose-700">Payment {String(d.status)}: {String(d.error ?? "")}</span>
        </Row>
      );
    case "final":
      return (
        <div className="animate-in rounded-2xl bg-ink p-4 text-sm leading-relaxed text-slate-100">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Agent summary</p>
          <p className="whitespace-pre-wrap">{String(d.text)}</p>
        </div>
      );
    case "error":
      return (
        <Row icon="!" tone="red">
          <span className="text-rose-700">Run failed: {String(d.message)}</span>
        </Row>
      );
    default:
      return null;
  }
}

function Row({ icon, tone, children }: { icon: string; tone: "gray" | "blue" | "green" | "amber" | "red" | "violet"; children: React.ReactNode }) {
  const ring = {
    gray: "bg-slate-100 text-slate-500",
    blue: "bg-sky-100 text-sky-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-rose-100 text-rose-700",
    violet: "bg-violet-100 text-violet-700",
  }[tone];
  return (
    <div className="animate-in flex gap-3 text-sm">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs", ring)} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
