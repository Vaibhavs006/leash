# Devpost submission draft

> Edit before submitting. Fill in the bracketed items.

## Tagline

Let an AI agent buy for your business on PayPal, inside limits it cannot break.

## Inspiration

AI agents are starting to shop, and the obvious next step is letting them pay. For a small business owner that's terrifying: an agent with a card can overspend, re-buy things, or be manipulated by a product page that says "ignore your budget." Prompting a model to "be careful" isn't a control. We wanted the equivalent of corporate-card spend controls, built for agents, on PayPal.

## What it does

Leash lets an owner write a **mandate**: budget, auto-pay limit, hard per-purchase cap, allowed categories, blocked merchants, quantity limits and expiry. A Claude-powered agent then searches real products (Channel3) and **proposes** carts. A deterministic policy engine decides each one:

- **Auto-approve:** small, in-policy carts are charged to a PayPal wallet the owner saved once with PayPal Vault (merchant-initiated Orders v2 charge).
- **Require approval:** carts over the auto-pay limit but under the cap go to the owner, who approves on PayPal's own checkout (customer-initiated), then Leash captures.
- **Deny:** anything else is blocked before PayPal is called.

Every request lands in an audit ledger with a 14-rule trace, the agent's reasoning and PayPal IDs, plus refunds and webhook reconciliation. A built-in red-team mode plants a malicious listing in search results, and "Simulate hijacked agent" shows that even a fully compromised agent can't move money outside the mandate.

## How we built it

- **Next.js 16 + TypeScript** single app, **PostgreSQL** (Drizzle), deployed on **Render** (web service + Postgres via Blueprint, deploys gated on CI).
- **PayPal:** Vault v3 setup and payment tokens; Orders v2 merchant-initiated vault charges and buyer-approved orders with capture; Payments v2 refunds; payment-token revocation; webhook signature verification and reconciliation. Every POST carries a `PayPal-Request-Id` for idempotency.
- **AI:** Claude via the Vercel AI SDK in a tool loop with exactly two tools, `search_products` and `request_purchase`. The model never sees credentials or payment tools.
- **Channel3** for live product search; results are snapshotted server-side and are the only prices Leash will charge.
- **Policy engine:** a pure function, heavily unit tested (45 unit tests overall). 26 integration tests against real Postgres cover concurrency (parallel requests can't overspend), idempotency, approval-time re-checks, refunds, webhooks, the agent loop with a scripted model, and the full offline demo flows.
- **Offline demo mode:** without API keys every integration falls back to a clearly labelled simulator (fictional catalog, rule-based planner, payment simulator) running through the same agent loop, policy engine and ledger, so judges can try everything without credentials.

## Challenges

- Making budget enforcement correct under concurrency: row locks plus reserving in-flight and pending spend.
- Getting the trust boundary right: we chose not to give the model the PayPal Agent Toolkit's payment tools, and built a capability-scoped tool instead.
- Displaying blocked attacks honestly: totals reflect what the agent *attempted*, priced from the catalog.

## Accomplishments

- A hijacked-agent attack that is visibly blocked on six independent rules, with PayPal never called.
- Merchant-initiated and customer-initiated PayPal flows used for what each is for.

## What's next

Per-agent mandates for multiple agents, PayPal Payouts for supplier settlement, an MCP server so any agent (not just ours) can shop through Leash's controls, and AP2-style signed mandates.

## Built with

nextjs, typescript, react, tailwindcss, postgresql, drizzle, paypal-orders-api, paypal-vault, paypal-webhooks, claude, anthropic, vercel-ai-sdk, channel3, render, github-actions

## Links

- Live demo: [https://<service>.onrender.com]
- Repo: https://github.com/Vaibhavs006/leash
- Video: [YouTube link]

## Testing instructions for judges

Open the live demo. Each visitor gets an isolated workspace with no sign-up. To try PayPal approval steps, log in with this **sandbox** buyer account: [sandbox buyer email] / [sandbox buyer password]. These are PayPal sandbox test credentials only; no real money.
"Simulate hijacked agent" works instantly with no setup.
