# QuoteCraft — Agency Lead-to-Quote & Margin Desk on Switch

**Track 01 Submission — Best Business Workflow (Flip the Switch Hackathon)**

> **The problem:** Small agencies and studios lose margin in chat. A prospect sends a rushed inquiry asking for a "25% partner discount, 5-day turnaround, and 4 rounds of revisions." A salesperson or solo founder eyeballs a number, sends a quote, and only realizes mid-project that internal delivery hours and rush overtime wiped out their profit margin.
>
> **The Switch solution:** **QuoteCraft** turns a Discord, Slack, or Mattermost channel into a human-gated **Lead-to-Quote & Margin Desk** powered by two adversarial Switch roles (`solutions-scoper` and `margin-auditor`), persistent room documents (`rate-card-and-policy` and `active-deal-sheet`), and a sub-second visual quote & SOW renderer (`render_quote.mjs`).

---

## Why This Workflow Stops Working Without Switch

1. **Shared, Load-Bearing Room Documents (`rate-card-and-policy` + `active-deal-sheet`):**
   - Both agents read the agency's live rate card (internal hourly cost vs. client list rate, mandatory **45% gross-margin floor**, **15% max discretionary discount**, **+25% Rush SLA fee** for `< 7` business days, **2-round revision cap**, and **50% upfront payment rule**) stored directly in the Switch room.
2. **Adversarial Role Separation (`solutions-scoper` vs. `margin-auditor`):**
   - **`solutions-scoper`** maps incoming prospect inquiries into itemized deliverables, updates `active-deal-sheet`, and renders a high-resolution **Deal & Margin Audit Card (`quote-card.png`)** + **Statement of Work (`quote-proposal.pdf`)** right into the thread via `send_attachment`.
   - **`margin-auditor`** never writes quotes—it independently recomputes internal cost vs. net client revenue and places the deal on **`⛔ MARGIN_HOLD`** if any policy guardrail fails, presenting concrete counter-offer options to the agency owner.
3. **Human Owner Gate in Chat (Voice-Driven with Wispr Flow):**
   - No quote leaves the desk until the agency owner breaks the tie in Discord/Slack (e.g., dictating via **Wispr Flow**: *"Go with Option A—add the 25% rush fee, cap revisions at 2 rounds, give them a 10% partner discount, and issue the final PDF"*).

---

## Repository Structure

```text
track1-lead-to-quote/
├── lead-to-quote.template.yaml          # Switch v2 template (agents, room, roles, seeded rate-card doc)
├── render_quote.mjs                     # Headless Chromium PNG Deal Card + A4 PDF SOW generator (< 0.9s)
├── examples/
│   ├── lead-trap-discount.json          # Prospect inquiry that triggers MARGIN_HOLD (43.6% margin, 5 violations)
│   ├── lead-remediated-approved.json    # Remediated quote after Auditor pushback & Owner sign-off (62.4% margin)
│   └── lead-clean-standard.json         # Clean standard inquiry that passes audit on first pass (55.4% margin)
├── DEMO_SCRIPT.md                       # 2.5-minute video walkthrough script + Wispr Flow voice prompts
└── README.md
```

---

## Quickstart (Run in Under 2 Minutes)

### 1. Provision the Room from the Switch Template
Import [`lead-to-quote.template.yaml`](./lead-to-quote.template.yaml) in **Switch Console** (*Create from template*) or via MCP:
```python
create_room_from_yaml(yaml_content=open("lead-to-quote.template.yaml").read())
```
The template automatically provisions:
- `{agency}-scoper` (assumes `solutions-scoper`)
- `{agency}-auditor` (assumes `margin-auditor`)
- `{agency}-deal-desk` bridged to your Discord/Slack workspace with `rate-card-and-policy` and `active-deal-sheet` pre-loaded.

### 2. Test the Standalone Visual Quote & PDF Renderer
Any agent in the room calls `render_quote.mjs` to produce the visual Discord card and client PDF in ~400–850 ms:
```bash
# 1. Render a "trap" lead that violates margin, discount, rush, and revision rules:
node render_quote.mjs examples/lead-trap-discount.json --out-dir ./out/trap

# 2. Render the remediated, owner-approved deal pack:
node render_quote.mjs examples/lead-remediated-approved.json --out-dir ./out/approved
```
Outputs in `./out/`:
- `quote-card.png` — 2400×1520 Retina dark-mode Deal & Margin Audit Card for inline Discord/Slack review
- `quote-proposal.pdf` — Client-ready A4 Statement of Work & Commercial Quote PDF
- `computed-deal.json` — Exact line-item economics and guardrail violation codes
