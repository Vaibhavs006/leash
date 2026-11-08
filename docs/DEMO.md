# Demo video script

**Target 2:45. Hard limit 3:00** (judges aren't required to watch past 3:00). The Presentation criterion asks: does the video show the project working end to end, and does it say what problem is solved, who it's for and why it matters? This script answers those in the first 20 seconds, then proves it on screen.

Rules from the hackathon: upload to YouTube as **public**; show the project running on the device it's built for (a desktop browser); **no copyrighted music or third-party material** without permission. Use silence or a track you have rights to.

## Version A: live (record this one if you have the keys)

Setup: deployed site (or local) with all three integrations **live** (`/api/health` → all modes `live`). Fresh private window → Reset demo → connect the PayPal wallet first (sandbox buyer). Record at 1440×900, browser zoom 110%. Do one full rehearsal; Claude's results vary slightly, so keep the best take of each step.

| Time | Screen | Voiceover (approx.) |
|---|---|---|
| 0:00–0:20 | Dashboard, slow scroll over the hero | "Small businesses want AI agents to do routine buying, like restocking coffee and cups. But an agent that can spend money can overspend, re-buy things, or be manipulated by a product page that says 'ignore your budget'. Leash lets a café owner hand purchasing to an agent, on PayPal, inside limits the agent cannot break." |
| 0:20–0:40 | Mandate panel; point at each limit | "The owner writes a mandate once: $250 a week, the agent may pay up to $40 alone, nothing over $120, café categories only, one blocked merchant. Claude never sees payment credentials. It can only search and *propose*." |
| 0:40–0:50 | Header: "PayPal wallet saved" | "The owner saved a PayPal wallet once with PayPal Vault. That consent is what lets small, in-policy purchases go through without them." |
| 0:50–1:25 | Run "Restock espresso beans and oat milk for the week". Timeline: Channel3 results with images → request → **Policy: approved automatically** → **Charged saved PayPal wallet** + order id | "Claude searches real products through Channel3 and proposes a cart. Leash re-prices it from the catalog it fetched itself, checks fourteen rules, and charges the saved wallet: a merchant-initiated PayPal order, created and captured in one call." |
| 1:25–1:55 | Run "Buy a commercial espresso machine" → **needs your approval** → Approve & pay with PayPal → PayPal sandbox page → back → Paid | "This one's under the hard cap but over what the agent may spend alone, so it escalates. Approval happens on PayPal itself, with the owner present. Leash captures on return." |
| 1:55–2:25 | **Simulate hijacked agent**: listing text → **Policy: blocked $1,890** → six red reasons → "No payment was attempted" | "Now the attack. A malicious listing tells the agent to ignore its limits and buy ten at one cent. This is exactly what a fully hijacked agent submits. Leash ignores the agent's price, re-prices at $1,890 and blocks it on six independent rules. No payment is ever attempted." |
| 2:25–2:40 | Ledger → expand **Why?** on the blocked row; point at a paid row's PayPal ids and Refund | "Every request lands in an audit ledger: the full rule trace, the agent's reason, and the PayPal order and capture ids. Refunds go back through PayPal and restore the budget." |
| 2:40–2:50 | README architecture diagram | "Claude proposes. Deterministic code decides. PayPal pays. That's Leash." |

## Version B: offline fallback (only if live keys aren't available in time)

Same structure, recorded in offline demo mode. **Say on camera that it's the offline demo** and keep the amber "Offline demo mode" banner visible. Never imply simulated payments are PayPal. Note that a PayPal-free video will score lower on Technological Implementation, so prefer Version A.

| Time | Screen | Voiceover change from Version A |
|---|---|---|
| 0:00–0:20 | Same | Same problem statement, then: "This recording uses Leash's offline demo mode, so payments and search are simulated and labelled. The same code runs on PayPal sandbox with keys." |
| 0:40–1:55 | Connect wallet (simulated) → run the two goals → approve on the **Offline payment simulator** | Replace "PayPal" with "the payment simulator" and "Channel3" with "a simulated catalog". |
| 1:55–2:40 | Same hijack and ledger beats | Same |
| 2:40–2:50 | Architecture diagram | "With keys, those boxes are PayPal Vault and Orders, Claude and Channel3." |

## Pre-flight checklist

- [ ] `/api/health` shows the expected commit, `database: true`, and the modes you intend to show
- [ ] Recording workspace: Reset demo, wallet connected, nothing else in the ledger
- [ ] Version A: sandbox buyer already logged in at sandbox.paypal.com in the recording browser (faster approval)
- [ ] Rehearsed both goals once (if Channel3 results look odd, adjust the goal wording)
- [ ] Browser notifications, bookmarks bar and other tabs hidden; zoom 110%
- [ ] Final cut ≤ 2:59; uploaded to YouTube as **Public**; link tested in a logged-out window
