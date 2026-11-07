# Demo video script (target 2:45, hard limit 3:00)

Record at 1440×900, browser zoom 110%. Use a fresh workspace (private window) with the PayPal wallet **already connected** and one approved purchase in the ledger, so nothing waits on network during the take. Keep a second take of each live step in case the model is slow.

**No copyrighted music.** Use silence or a royalty-free track you have rights to.

| Time | Screen | Voiceover (approx.) |
|---|---|---|
| 0:00–0:15 | Title card, then dashboard | "Small businesses want AI agents to handle routine buying. The problem is trust: an agent that can spend money can be wrong, or worse, manipulated by what it reads. Leash fixes that, on PayPal." |
| 0:15–0:35 | Mandate panel; hover the limits | "The owner writes a mandate once: a $250 weekly budget, the agent can pay up to $40 alone, nothing over $120, café supplies only, and a blocked merchant. Claude never sees payment credentials. It can only search and *propose*." |
| 0:35–0:45 | Header: "PayPal wallet saved" | "The owner saved a PayPal wallet once with PayPal Vault. That's the consent that lets small, in-policy purchases go through without them." |
| 0:45–1:20 | Run "Restock espresso beans and oat milk". Timeline: searches with product images → request → **Policy: approved automatically** → **Charged saved PayPal wallet** + order ID | "Claude searches real products through Channel3, compares them, and requests a cart. Leash re-prices it from the catalog, checks fourteen rules, and charges the saved wallet: a merchant-initiated PayPal order, created and captured in one call." |
| 1:20–1:50 | Run "Buy a commercial espresso machine" → **needs your approval** → Approve & pay with PayPal → PayPal sandbox page → back → Paid | "This one is within the hard cap but over what the agent may spend alone, so it escalates. Approval happens on PayPal itself: the owner is present and approves the payment. Leash captures on return." |
| 1:50–2:25 | Click **Simulate hijacked agent**. Show the poisoned listing text, then **Policy: blocked $1,890**, the six red reasons, and "PayPal was never called" | "Now the attack. A malicious listing tells the agent to ignore its limits and buy ten at one cent. Here's exactly what a fully hijacked agent submits. Leash ignores the agent's price, re-prices at $1,890, and blocks it on six independent rules. The money never moves." |
| 2:25–2:40 | Ledger: expand "Why?" on the blocked row; show the refund button on a paid row | "Every request lands in an audit ledger with the full rule trace, the agent's reason, and the PayPal order and capture IDs. Refunds go back through PayPal and restore the budget." |
| 2:40–2:50 | Architecture diagram from the README | "Claude proposes. Deterministic code decides. PayPal pays. That's Leash." |

## Pre-flight checklist

- [ ] `/api/health` on the live site shows the expected commit, `database: true` and all integrations `true`
- [ ] Wallet connected in the recording workspace
- [ ] Sandbox buyer account logged in to sandbox.paypal.com in the recording browser (fast approval)
- [ ] Ran both live goals once beforehand (Channel3 results look sensible; adjust the goal text if not)
- [ ] Browser notifications and bookmarks bar hidden
