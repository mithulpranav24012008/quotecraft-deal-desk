# 2.5-Minute Demo & Video Script — QuoteCraft (Track 01 + Code with Wispr)

Use this script to record the **Track 01 (Best Business Workflow)** demo video while dictating your prompts in Discord with **Wispr Flow** (so the same recording also proves **Code with Wispr**).

---

## Scene 1 — The Problem & Room Setup (0:00 – 0:30)
1. Show the **Switch Console** with `lead-to-quote.template.yaml` loaded and the room `northlight-deal-desk` bridged to your Discord channel.
2. Briefly click the **Room Documents** tab in Switch Console to show `rate-card-and-policy` (pointing out the **45% gross-margin floor**, **15% discount cap**, **+25% Rush SLA fee**, and **2-round revision cap**).

---

## Scene 2 — Dictating a "Trap" Client Lead via Wispr Flow (0:30 – 1:15)
Hold your **Wispr Flow** hotkey in Discord and speak this prompt naturally:

> **Voice Prompt 1 (Wispr Flow):**
> *"@scoper New inquiry from Maya Lin at NovaPay Fintech for their Series B launch. They want a 60-second 3D motion launch film, an interactive WebGL product tour on their site, creative direction, and custom sound design. Catch is: they want it delivered in 5 business days, they're asking for a 25% partner discount, 4 rounds of revisions, and only 25% upfront. Scope this against our rate card and post the deal card."*

### What Happens in the Room:
1. **`solutions-scoper` (`@scoper`)** reads `rate-card-and-policy`, creates the per-deal room document `deal-<quote_id>` (`96 hours`, `$6,660` internal cost, `$15,740` list price, `$11,805` net after 25% discount), runs `render_quote.mjs`, and attaches **`quote-card.png`** (`⛔ MARGIN HOLD — 43.6% Gross Margin`) to the Discord thread.
2. **`margin-auditor` (`@auditor`)** automatically steps in and blocks release with a 4-point audit verdict:
   - Gross margin is **43.6%** (below the **45.0%** floor by `$305`).
   - **25% discount** exceeds the **15%** discretionary cap.
   - **5-day turnaround** (< 7 business days) is missing the mandatory **+25% Rush SLA surcharge** (`+$3,935`).
   - **4 revision rounds** and **25% upfront** violate the **2-round cap** and **50% deposit policy**.
   - Presents **Option A (Enforce Rush SLA + 10% Partner Discount -> $17,708 net, 62.4% margin)** vs. **Option B (Drop WebGL tour to hit budget)**.

---

## Scene 3 — Breaking the Tie & Issuing the Final PDF SOW by Voice (1:15 – 2:15)
Hold your **Wispr Flow** hotkey in Discord and dictate your executive decision:

> **Voice Prompt 2 (Wispr Flow):**
> *"@scoper @auditor Good catch on the rush SLA and margin erosion. Let's go with Option A: keep all four deliverables, apply the mandatory 25% five-day rush fee, give them a 10% partner discount, cap revisions at 2 rounds, and require 50% upfront. I approve releasing the final quote—render the updated card and the client PDF proposal."*

### What Happens in the Room:
1. **`solutions-scoper`** updates `deal-<quote_id>` to `FINAL_APPROVED`, runs `render_quote.mjs`, and drops both:
   - The green **`quote-card.png`** (`✓ APPROVED FOR CLIENT RELEASE — $17,708 Net Quote | 62.4% Gross Margin`)
   - The client-ready A4 **`quote-proposal.pdf`** (`Statement of Work & Commercial Quote`) right into Discord!
2. Open `quote-proposal.pdf` on screen for 5 seconds to show the clean itemized table, rush SLA line item, partner discount, and signature block.
3. Show your **Wispr Flow Insights Scorecard** on screen for the last 5 seconds.
