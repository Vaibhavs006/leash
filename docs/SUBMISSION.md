# Devpost submission draft

> Fill in every `[bracketed]` item before submitting. Delete this line.

## Tagline

Let an AI agent buy for your business on PayPal, inside limits it cannot break.

## Inspiration

AI agents are starting to shop, and the obvious next step is letting them pay. For a small business owner that's terrifying: an agent with a card can overspend, re-buy things, or be manipulated by a product page that says "ignore your budget." Prompting a model to "be careful" isn't a control. We wanted the equivalent of corporate-card spend controls, built for agents, on PayPal.

## Who it's for

Owners of small businesses, like a café or a salon, who re-order the same supplies every week and would happily delegate it to an agent if they could trust it. Today they either do it by hand or hand over a card with no guardrails. Leash gives them a written mandate, automatic payment for the routine stuff, a one-tap PayPal approval for anything bigger, and an audit trail for everything.

## What it does

Leash lets an owner write a **mandate**: budget, auto-pay limit, hard per-purchase cap, allowed categories, blocked merchants, quantity limits and expiry. A Claude-powered agent then searches real products (Channel3) and **proposes** carts. A deterministic policy engine decides each one:

- **Auto-approve:** small, in-policy carts are charged to a PayPal wallet the owner saved once with PayPal Vault (merchant-initiated Orders v2 charge).
- **Require approval:** carts over the auto-pay limit but under the cap go to the owner, who approves on PayPal's own checkout (customer-initiated), then Leash captures.
- **Deny:** anything else is blocked before any payment is attempted.

Every request lands in an audit ledger with a 14-rule trace, the agent's reasoning and PayPal ids, plus refunds and webhook reconciliation. A red-team mode plants a malicious listing in search results, and "Simulate hijacked agent" shows that even a fully compromised agent can't move money outside the mandate.

## How we built it

- **Next.js 16 + TypeScript** single app, **PostgreSQL** (Drizzle), deployed on **Render** (web service + Postgres via Blueprint, deploys gated on CI).
- **PayPal:** Vault v3 setup and payment tokens; Orders v2 merchant-initiated vault charges and buyer-approved orders with capture; Payments v2 refunds; payment-token revocation; webhook signature verification and reconciliation. Every POST carries a `PayPal-Request-Id` for idempotency.
- **AI:** Claude via the Vercel AI SDK in a tool loop with exactly two tools, `search_products` and `request_purchase`. The model never sees credentials or payment tools.
- **Channel3** for live product search. Results are snapshotted server-side and are the only prices Leash will charge.
- **Policy engine:** a pure, deterministic function and the only path from a proposal to a payment. 45 unit tests overall; 26 integration tests against real Postgres cover concurrency (parallel requests can't overspend), idempotency, approval-time re-checks, refunds, webhooks, the agent loop, and the full offline demo flows. A smoke test verifies the deployed site.
- **Offline demo mode:** without API keys, each integration falls back to a clearly labelled simulator (fictional catalog, rule-based planner, payment simulator) running through the same agent loop, policy engine and ledger.

## AI tools used

| Tool | How it's used |
|---|---|
| **Claude** (`claude-sonnet-5-5`, Anthropic) via the **Vercel AI SDK** | The purchasing agent. It plans search queries, compares products, writes the justification stored with each purchase, adapts when the policy denies a cart, and summarises the run for the owner. It is deliberately given no payment capability. |
| **Channel3 API** | Real product search (titles, images, categories, in-stock USD prices). It's AI-oriented product data that grounds the agent in products that actually exist. |
| **Claude Code** | Development assistant used while building the project. |

## Challenges

- Making budget enforcement correct under concurrency: row locks plus reserving in-flight and pending spend.
- Getting the trust boundary right: we chose not to give the model the PayPal Agent Toolkit's payment tools, and built a capability-scoped tool instead.
- Displaying blocked attacks honestly: totals reflect what the agent *attempted*, priced from the catalog.
- Making the project judgeable without credentials, without ever passing simulated data off as real.

## Accomplishments

- A hijacked-agent attack that is visibly blocked on six independent rules, with no payment attempted.
- Merchant-initiated and customer-initiated PayPal flows, each used for what it's for.
- Every decision is explainable: the ledger shows which of 14 rules passed or failed and why.

## What's next

Per-agent mandates for multiple agents, PayPal Payouts for supplier settlement, an MCP server so any agent (not just ours) can shop through Leash's controls, and AP2-style signed mandates.

## Built with

nextjs, typescript, react, tailwindcss, postgresql, drizzle, paypal-orders-api, paypal-vault, paypal-webhooks, claude, anthropic, vercel-ai-sdk, channel3, render, github-actions

## Links

- Live demo: [https://<service>.onrender.com]
- Repo: https://github.com/Vaibhavs006/leash (MIT licence)
- Video: [YouTube link]

## Testing instructions for judges

1. Open the live demo. Each visitor gets an isolated workspace; no sign-up.
2. The footer and the banner say which integrations are **live** and which are **simulated**.
3. Click **Simulate hijacked agent**: it works instantly in any mode.
4. Live mode: click **Connect PayPal wallet**, then run a goal such as "Restock espresso beans and oat milk for the week". For PayPal approval steps, log in with this **sandbox** buyer account: [sandbox buyer email] / [sandbox buyer password]. These are PayPal sandbox test credentials only; no real money moves.
5. Offline mode (if shown): click **Load sample history** to see the full lifecycle in one click.
6. Expand **Why?** on any ledger row to see the full rule trace.
7. **Reset demo** (top right) clears your workspace at any time.

To run locally, see the README (works without any keys).

[Live verification status: update once `spike:paypal` and `check:channel3` have passed, e.g. "PayPal sandbox, Claude and Channel3 verified live on <date>".]
