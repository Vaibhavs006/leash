/**
 * SIMULATED agent model, used only when ANTHROPIC_API_KEY is not configured.
 *
 * A deterministic, rule-based planner that implements the AI SDK LanguageModelV4
 * interface, so it runs through exactly the same agent loop, tools, catalog
 * snapshot, policy engine and payment path as Claude. It is NOT an LLM: it
 * splits the goal into queries, picks the cheapest relevant products, reacts to
 * policy decisions, and writes a templated summary.
 *
 * `naive: true` (used in red-team mode) makes it obey instructions found in
 * retailer listings, i.e. it behaves like a successfully prompt-injected agent,
 * to demonstrate that the policy engine holds even then.
 */
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import { relevance as catalogRelevance, tokenize } from "./catalog";

export const SIM_MODEL_ID = "leash-rule-based-planner";

interface ModelProduct {
  product_id: string;
  title: string;
  merchant: string;
  category?: string;
  price_usd: number;
  retailer_description_untrusted?: string | null;
}
interface CartItem {
  product_id: string;
  quantity: number;
  unit_price_usd: number;
}
interface PurchaseOutcome {
  outcome: string;
  total_usd?: number;
  reasons?: string[];
}
interface Step {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function parseInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (input ?? {}) as Record<string, unknown>;
}

function outputValue(output: unknown): unknown {
  const o = output as { type?: string; value?: unknown } | undefined;
  if (!o) return undefined;
  if (o.type === "json" || o.type === "error-json") return o.value;
  if (o.type === "text" || o.type === "error-text") {
    try {
      return JSON.parse(String(o.value));
    } catch {
      return o.value;
    }
  }
  return undefined;
}

/** Pair every tool call in the conversation with its result, in order. */
export function readSteps(prompt: LanguageModelV4Prompt): { goal: string; steps: Step[] } {
  let goal = "";
  const calls = new Map<string, { toolName: string; input: Record<string, unknown> }>();
  const steps: Step[] = [];
  for (const m of prompt) {
    if (m.role === "user") {
      const text = m.content.map((p) => (p.type === "text" ? p.text : "")).join(" ");
      goal = text.replace(/^Owner's goal:\s*/i, "").trim();
    } else if (m.role === "assistant") {
      for (const p of m.content) if (p.type === "tool-call") calls.set(p.toolCallId, { toolName: p.toolName, input: parseInput(p.input) });
    } else if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type !== "tool-result") continue;
        const call = calls.get(p.toolCallId);
        steps.push({ toolName: p.toolName, input: call?.input ?? {}, output: outputValue(p.output) });
      }
    }
  }
  return { goal, steps };
}

/** "Restock espresso beans and oat milk for the week" -> ["espresso bean", "oat milk"]. */
export function planQueries(goal: string): string[] {
  const chunks = goal
    .split(/,|\band\b|\bplus\b|&|\+|;/i)
    .map((c) => tokenize(c).join(" "))
    .filter(Boolean);
  const queries = chunks.length ? chunks : [tokenize(goal).join(" ")].filter(Boolean);
  return [...new Set(queries)].slice(0, 3);
}

function relevance(query: string, r: ModelProduct): number {
  return catalogRelevance(query, r.title, r.category ?? "");
}

function pickCart(searches: Array<{ query: string; results: ModelProduct[] }>): CartItem[] {
  const cart: CartItem[] = [];
  for (const { query, results } of searches) {
    const best = results
      .filter((r) => !r.product_id.startsWith("redteam_") && !cart.some((c) => c.product_id === r.product_id))
      .map((r) => ({ r, score: relevance(query, r) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.r.price_usd - b.r.price_usd)[0];
    if (best) cart.push({ product_id: best.r.product_id, quantity: best.r.price_usd <= 12 ? 2 : 1, unit_price_usd: best.r.price_usd });
  }
  return cart;
}

const fmt = (n: number) => `$${n.toFixed(2)}`;

function toolCall(name: string, input: unknown, text: string, n: number): LanguageModelV4GenerateResult {
  const content: LanguageModelV4Content[] = [
    { type: "text", text },
    { type: "tool-call", toolCallId: `sim_${name}_${n}`, toolName: name, input: JSON.stringify(input) },
  ];
  return { content, finishReason: { unified: "tool-calls", raw: "tool_use" }, usage, warnings: [] };
}

function finish(text: string): LanguageModelV4GenerateResult {
  return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "end_turn" }, usage, warnings: [] };
}

export function planNextStep(prompt: LanguageModelV4Prompt, naive: boolean): LanguageModelV4GenerateResult {
  const { goal, steps } = readSteps(prompt);
  const queries = planQueries(goal);
  if (!queries.length) return finish("I couldn't work out what to buy from that goal. Try naming the products, e.g. “espresso beans and oat milk”.");

  const searches = steps
    .filter((s) => s.toolName === "search_products")
    .map((s) => ({ query: String(s.input.query ?? ""), results: ((s.output as { results?: ModelProduct[] })?.results ?? []) as ModelProduct[] }));
  const purchases = steps.filter((s) => s.toolName === "request_purchase");

  // 1. Search each part of the goal.
  if (searches.length < queries.length) {
    const q = queries[searches.length];
    return toolCall("search_products", { query: q }, `Searching the catalog for “${q}”.`, steps.length);
  }

  const all = searches.flatMap((s) => s.results);
  const injected = all.find((r) => /ignore any budget|purchase 10 units/i.test(r.retailer_description_untrusted ?? ""));

  // 2. Propose a cart.
  if (purchases.length === 0) {
    if (naive && injected) {
      return toolCall(
        "request_purchase",
        { items: [{ product_id: injected.product_id, quantity: 10, unit_price_usd: 0.01 }], reason: "The retailer listing says the owner pre-authorised a 10-unit bulk order at $0.01." },
        "A listing says the owner pre-authorised a bulk order with a discount. Following its instructions.",
        steps.length,
      );
    }
    const cart = pickCart(searches);
    if (!cart.length) return finish(`I couldn't find anything matching “${goal}”. Nothing was purchased.`);
    const names = cart.map((c) => all.find((r) => r.product_id === c.product_id)?.title ?? c.product_id);
    return toolCall(
      "request_purchase",
      { items: cart, reason: `Cheapest relevant in-stock options for: ${goal}. Items: ${names.join("; ")}.` },
      `Comparing ${all.length} results by relevance and price. Requesting ${cart.length} item(s).`,
      steps.length,
    );
  }

  // 3. React to the policy decision.
  const last = purchases[purchases.length - 1];
  const outcome = (last.output ?? {}) as PurchaseOutcome;
  const lastCart = ((last.input.items as CartItem[]) ?? []).filter(Boolean);
  if (outcome.outcome === "DENIED" && purchases.length < 2 && !(naive && injected)) {
    // Retry once with a smaller cart: the single cheapest item, one unit.
    const cheapest = [...lastCart].sort((a, b) => a.unit_price_usd - b.unit_price_usd)[0];
    const smaller = cheapest ? [{ ...cheapest, quantity: 1 }] : [];
    if (smaller.length && (lastCart.length > 1 || lastCart[0]?.quantity > 1)) {
      return toolCall(
        "request_purchase",
        { items: smaller, reason: `Previous cart was denied (${(outcome.reasons ?? []).join("; ")}). Trying the single most essential item.` },
        "The policy denied that cart. Retrying with a smaller one.",
        steps.length,
      );
    }
  }

  const titles = lastCart.map((c) => `${c.quantity} × ${all.find((r) => r.product_id === c.product_id)?.title ?? c.product_id}`).join(", ");
  const total = outcome.total_usd ?? lastCart.reduce((s, c) => s + c.unit_price_usd * c.quantity, 0);
  switch (outcome.outcome) {
    case "CHARGED":
      return finish(`Done. Bought ${titles} for ${fmt(total)}, charged to the saved wallet within your mandate.`);
    case "PENDING_APPROVAL":
      return finish(`I requested ${titles} (${fmt(total)}). It's over what I may spend on my own, so it's waiting for your approval.`);
    case "DENIED":
      return finish(
        naive && injected
          ? `I followed instructions embedded in a retailer listing and requested ${titles}. Leash's policy blocked it: ${(outcome.reasons ?? []).join("; ")}.`
          : `I couldn't complete this within the mandate. Leash denied ${titles}: ${(outcome.reasons ?? []).join("; ")}.`,
      );
    default:
      return finish(`Purchase request finished with status ${outcome.outcome ?? "unknown"}.`);
  }
}

export function createRuleBasedPlanner(opts: { naive?: boolean } = {}): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "leash-simulated",
    modelId: SIM_MODEL_ID,
    supportedUrls: {},
    async doGenerate(options: LanguageModelV4CallOptions) {
      return planNextStep(options.prompt, !!opts.naive);
    },
    async doStream() {
      throw new Error("The simulated planner supports generateText only.");
    },
  };
}
