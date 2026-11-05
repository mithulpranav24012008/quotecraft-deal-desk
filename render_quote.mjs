#!/usr/bin/env node
/**
 * QuoteCraft Deal Desk Engine & Renderer (`render_quote.mjs`)
 *
 * Usage:
 *   node render_quote.mjs <deal.json> [--out-dir ./out] [--rate-card ./rate-card.json] [--check]
 *
 * 1. Looks up every deliverable's role in `rate-card.json` (refuses unknown roles so the AI
 *    cannot invent or mistype hourly cost/list rates).
 * 2. Deterministically computes internal cost, list price, rush fees, discounts, and gross margin %,
 *    and checks all 5 Deal Desk policy guardrails.
 * 3. With `--check`, prints `computed-deal.json` to stdout without launching a browser.
 * 4. Otherwise, uses Playwright (headless Chromium) to render:
 *    - `<out-dir>/quote-card.png`     — 1200x760 Retina dark-mode Deal & Margin Audit Card
 *    - `<out-dir>/quote-proposal.pdf` — Clean A4 Client Statement of Work & Quote PDF
 *    - `<out-dir>/computed-deal.json` — Computed numbers & audit flags
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findBrowserExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const sysChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(sysChrome)) {
    return sysChrome;
  }
  return undefined;
}

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));

const fmtPct = (n) => `${n.toFixed(1)}%`;

function computeDeal(raw, rateCard) {
  const minMarginPct = Number(rateCard.min_margin_pct ?? 45);
  const maxDiscountPct = Number(rateCard.max_discount_pct ?? 15);
  const rushThresholdDays = Number(rateCard.rush_threshold_days ?? 7);
  const requiredRushFeePct = Number(rateCard.rush_fee_pct ?? 25);
  const maxRevisionRounds = Number(rateCard.max_revision_rounds ?? 2);
  const minUpfrontPct = Number(rateCard.min_upfront_pct ?? 50);

  const discountPct = Number(raw.discount_pct ?? 0);
  const rushFeePct = Number(raw.rush_fee_pct ?? 0);
  const deliveryDays = Number(raw.delivery_days ?? 14);
  const revisionRounds = raw.revision_rounds ?? 2;
  const upfrontPct = Number(raw.upfront_pct ?? 50);

  const rolesMap = rateCard.roles || {};
  const allowedRoles = Object.keys(rolesMap);

  const items = (raw.items || []).map((item, idx) => {
    const roleName = item.role;
    const roleRates = rolesMap[roleName];
    if (!roleRates) {
      throw new Error(
        `Line item #${idx + 1} ("${item.deliverable}") uses unknown role "${roleName}". Allowed roles in rate-card.json: ${allowedRoles.join(", ")}`
      );
    }
    const hours = Number(item.hours || 0);
    if (hours <= 0 || Number.isNaN(hours)) {
      throw new Error(`Line item #${idx + 1} ("${item.deliverable}") must have positive hours.`);
    }
    const costRate = Number(roleRates.internal_cost_rate);
    const listRate = Number(roleRates.client_list_rate);
    const internalCost = hours * costRate;
    const listPrice = hours * listRate;
    const lineMarginPct =
      listPrice > 0 ? ((listPrice - internalCost) / listPrice) * 100 : 0;
    return {
      deliverable: item.deliverable,
      role: roleName,
      hours,
      costRate,
      listRate,
      internalCost,
      listPrice,
      lineMarginPct: Number(lineMarginPct.toFixed(1)),
    };
  });

  const totalHours = items.reduce((s, i) => s + i.hours, 0);
  const totalInternalCost = items.reduce((s, i) => s + i.internalCost, 0);
  const subtotalListPrice = items.reduce((s, i) => s + i.listPrice, 0);
  const rushSurcharge = subtotalListPrice * (rushFeePct / 100);
  const discountAmount = (subtotalListPrice + rushSurcharge) * (discountPct / 100);
  const netClientPrice = subtotalListPrice + rushSurcharge - discountAmount;
  const grossProfit = netClientPrice - totalInternalCost;
  const grossMarginPct =
    netClientPrice > 0 ? (grossProfit / netClientPrice) * 100 : 0;

  // Deterministic policy guardrail checks against rate-card.json
  const violations = [];
  if (grossMarginPct < minMarginPct - 1e-6) {
    const requiredNetPrice = totalInternalCost / (1 - minMarginPct / 100);
    const shortfall = requiredNetPrice - netClientPrice;
    violations.push({
      code: "MARGIN_BELOW_FLOOR",
      severity: "BLOCKER",
      title: `Gross margin ${fmtPct(grossMarginPct)} is below the ${minMarginPct}% floor`,
      detail: `Net price is short by ${fmtCurrency(shortfall)} (needs >= ${fmtCurrency(requiredNetPrice)} net revenue or <= ${fmtCurrency(netClientPrice * (1 - minMarginPct / 100))} internal cost).`,
    });
  }
  if (discountPct > maxDiscountPct) {
    violations.push({
      code: "DISCOUNT_CAP_EXCEEDED",
      severity: "BLOCKER",
      title: `Discount of ${discountPct}% exceeds ${maxDiscountPct}% discretionary cap`,
      detail: `Reduce discount to <= ${maxDiscountPct}% or trim scope hours to preserve margin.`,
    });
  }
  if (deliveryDays < rushThresholdDays && rushFeePct < requiredRushFeePct) {
    violations.push({
      code: "UNPRICED_RUSH_SLA",
      severity: "BLOCKER",
      title: `${deliveryDays}-day rush timeline requires +${requiredRushFeePct}% Rush SLA fee`,
      detail: `Deadlines under ${rushThresholdDays} business days require a ${requiredRushFeePct}% rush surcharge (currently ${rushFeePct}%).`,
    });
  }
  if (revisionRounds === "unlimited" || Number(revisionRounds) > maxRevisionRounds) {
    violations.push({
      code: "UNBOUNDED_REVISIONS",
      severity: "BLOCKER",
      title: `Revision cap exceeded (${revisionRounds} requested vs. ${maxRevisionRounds} max)`,
      detail: `Cap fixed-price scope at ${maxRevisionRounds} revision rounds or add a monthly retainer.`,
    });
  }
  if (upfrontPct < minUpfrontPct) {
    violations.push({
      code: "PAYMENT_TERMS_RISK",
      severity: "BLOCKER",
      title: `Upfront deposit (${upfrontPct}%) is below the ${minUpfrontPct}% policy minimum`,
      detail: `Standard agency terms require ${minUpfrontPct}% upfront prior to kickoff.`,
    });
  }

  const hasBlockers = violations.some((v) => v.severity === "BLOCKER");
  let status = raw.status;
  if (!status || status === "AUTO") {
    status = hasBlockers ? "MARGIN_HOLD" : "AUDIT_PASSED";
  } else if (status === "FINAL_APPROVED" && hasBlockers && !raw.owner_override) {
    status = "MARGIN_HOLD";
  }

  return {
    quote_id: raw.quote_id || "QC-2026-042",
    agency_name: raw.agency_name || rateCard.agency_name || "Northlight Creative",
    client_name: raw.client_name || "Acme Corp",
    client_contact: raw.client_contact || "VP of Marketing",
    project_title: raw.project_title || "Product Launch Campaign",
    summary: raw.summary || "",
    date: raw.date || "2026-11-05",
    delivery_days: deliveryDays,
    revision_rounds: revisionRounds,
    upfront_pct: upfrontPct,
    payment_terms:
      raw.payment_terms || `${upfrontPct}% Upfront / ${100 - upfrontPct}% on Delivery`,
    min_margin_pct: minMarginPct,
    discount_pct: discountPct,
    rush_fee_pct: rushFeePct,
    items,
    totalHours,
    totalInternalCost,
    subtotalListPrice,
    rushSurcharge,
    discountAmount,
    netClientPrice,
    grossProfit,
    grossMarginPct: Number(grossMarginPct.toFixed(1)),
    violations,
    status,
    approved_by: raw.approved_by || null,
  };
}

function buildCardHtml(d) {
  const isHold = d.status === "MARGIN_HOLD";
  const isFinal = d.status === "FINAL_APPROVED";
  const badgeColor = isHold
    ? "#ef4444"
    : isFinal
    ? "#10b981"
    : "#3b82f6";
  const badgeBg = isHold
    ? "rgba(239,68,68,0.16)"
    : isFinal
    ? "rgba(16,185,129,0.16)"
    : "rgba(59,130,246,0.16)";
  const badgeLabel = isHold
    ? "⛔ MARGIN HOLD — BLOCKED BY AUDITOR"
    : isFinal
    ? `✓ APPROVED FOR CLIENT RELEASE${d.approved_by ? ` (${d.approved_by})` : ""}`
    : "✓ AUDIT PASSED — READY FOR OWNER SIGN-OFF";

  const marginBarWidth = Math.max(0, Math.min(100, d.grossMarginPct));
  const floorMarkerLeft = Math.max(0, Math.min(100, d.min_margin_pct));
  const marginColor =
    d.grossMarginPct >= d.min_margin_pct ? "#10b981" : "#ef4444";

  const rowsHtml = d.items
    .map(
      (i) => `
      <tr>
        <td>
          <div class="item-name">${i.deliverable}</div>
          <div class="item-role">${i.role} (${fmtCurrency(i.costRate)} cost / ${fmtCurrency(i.listRate)} list)</div>
        </td>
        <td class="num">${i.hours}h</td>
        <td class="num muted">${fmtCurrency(i.internalCost)}</td>
        <td class="num">${fmtCurrency(i.listPrice)}</td>
        <td class="num"><span class="pill">${fmtPct(i.lineMarginPct)}</span></td>
      </tr>`
    )
    .join("");

  const violationsHtml =
    d.violations.length > 0
      ? d.violations
          .map(
            (v) => `
        <div class="violation-item">
          <div class="v-title">⚠️ ${v.title}</div>
          <div class="v-detail">${v.detail}</div>
        </div>`
          )
          .join("")
      : `<div class="pass-box">
          <div class="pass-title">✅ All Deal Desk Guardrails Satisfied</div>
          <div class="pass-detail">Gross margin (${fmtPct(
            d.grossMarginPct
          )}) exceeds the ${d.min_margin_pct}% floor • Revision cap (${
          d.revision_rounds
        } rounds) • ${d.payment_terms}</div>
        </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    min-height: 760px;
    background: #090d16;
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    padding: 32px 36px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background-image:
      radial-gradient(circle at 90% 10%, rgba(56, 189, 248, 0.10), transparent 40%),
      radial-gradient(circle at 10% 90%, rgba(16, 185, 129, 0.08), transparent 40%);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid #1e293b;
    padding-bottom: 20px;
  }
  .brand {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.6px;
    color: #38bdf8;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .title {
    font-size: 26px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.5px;
  }
  .subtitle {
    font-size: 14px;
    color: #94a3b8;
    margin-top: 4px;
  }
  .badge {
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.6px;
    background: ${badgeBg};
    color: ${badgeColor};
    border: 1px solid ${badgeColor};
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin: 20px 0;
  }
  .kpi {
    background: #111827;
    border: 1px solid #1f2937;
    border-radius: 12px;
    padding: 16px 18px;
  }
  .kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #94a3b8;
    font-weight: 600;
  }
  .kpi-val {
    font-size: 28px;
    font-weight: 800;
    margin-top: 6px;
    color: #f8fafc;
  }
  .kpi-sub {
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
  }
  .main-grid {
    display: grid;
    grid-template-columns: 1.45fr 1fr;
    gap: 20px;
    flex: 1;
  }
  .panel {
    background: #111827;
    border: 1px solid #1f2937;
    border-radius: 12px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
  }
  .panel-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #94a3b8;
    font-weight: 700;
    margin-bottom: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    color: #64748b;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    padding-bottom: 8px;
    border-bottom: 1px solid #1e293b;
  }
  th.num, td.num { text-align: right; }
  td {
    padding: 9px 0;
    border-bottom: 1px solid rgba(30, 41, 59, 0.6);
  }
  .item-name { font-weight: 600; color: #e2e8f0; }
  .item-role { font-size: 11px; color: #64748b; margin-top: 2px; }
  .muted { color: #94a3b8; }
  .pill {
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
    padding: 2px 8px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 11px;
  }
  .totals {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: #cbd5e1;
  }
  .gauge-wrap {
    margin-bottom: 16px;
    background: #0b1120;
    border: 1px solid #1e293b;
    padding: 14px;
    border-radius: 10px;
  }
  .gauge-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 8px;
  }
  .gauge-track {
    position: relative;
    height: 14px;
    background: #1e293b;
    border-radius: 999px;
    overflow: visible;
  }
  .gauge-fill {
    height: 100%;
    width: ${marginBarWidth}%;
    background: ${marginColor};
    border-radius: 999px;
  }
  .gauge-floor {
    position: absolute;
    top: -4px;
    bottom: -4px;
    left: ${floorMarkerLeft}%;
    width: 3px;
    background: #f59e0b;
  }
  .violation-item {
    background: rgba(239, 68, 68, 0.10);
    border-left: 3px solid #ef4444;
    padding: 10px 12px;
    border-radius: 6px;
    margin-bottom: 10px;
  }
  .v-title { font-size: 13px; font-weight: 700; color: #fca5a5; }
  .v-detail { font-size: 12px; color: #cbd5e1; margin-top: 4px; line-height: 1.35; }
  .pass-box {
    background: rgba(16, 185, 129, 0.10);
    border-left: 3px solid #10b981;
    padding: 14px;
    border-radius: 8px;
  }
  .pass-title { font-size: 14px; font-weight: 700; color: #6ee7b7; }
  .pass-detail { font-size: 12px; color: #cbd5e1; margin-top: 6px; line-height: 1.4; }
  .footer {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${d.agency_name} • QuoteCraft Deal Desk (${d.quote_id})</div>
      <div class="title">${d.client_name} — ${d.project_title}</div>
      <div class="subtitle">Timeline: ${d.delivery_days} business days • Revisions: ${
    d.revision_rounds
  } rounds • Terms: ${d.payment_terms}</div>
    </div>
    <div class="badge">${badgeLabel}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Net Client Quote</div>
      <div class="kpi-val">${fmtCurrency(d.netClientPrice)}</div>
      <div class="kpi-sub">List: ${fmtCurrency(d.subtotalListPrice)}${
    d.discount_pct > 0 ? ` (−${d.discount_pct}% disc)` : ""
  }${d.rush_fee_pct > 0 ? ` (+${d.rush_fee_pct}% rush)` : ""}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Internal Delivery Cost</div>
      <div class="kpi-val">${fmtCurrency(d.totalInternalCost)}</div>
      <div class="kpi-sub">${d.totalHours} billable hours scoped</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Net Gross Profit</div>
      <div class="kpi-val" style="color:${marginColor}">${fmtCurrency(
    d.grossProfit
  )}</div>
      <div class="kpi-sub">Agency net contribution</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Gross Margin %</div>
      <div class="kpi-val" style="color:${marginColor}">${fmtPct(
    d.grossMarginPct
  )}</div>
      <div class="kpi-sub">Mandatory floor: ${d.min_margin_pct}.0%</div>
    </div>
  </div>

  <div class="main-grid">
    <div class="panel">
      <div class="panel-title">Scoped Deliverables & Line Economics (from rate-card.json)</div>
      <table>
        <thead>
          <tr>
            <th>Deliverable</th>
            <th class="num">Hrs</th>
            <th class="num">Int. Cost</th>
            <th class="num">List Price</th>
            <th class="num">Margin</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div class="totals">
        <span>Subtotal: <strong>${fmtCurrency(d.subtotalListPrice)}</strong>${
    d.rushSurcharge > 0
      ? ` • Rush (+${d.rush_fee_pct}%): <strong>+${fmtCurrency(d.rushSurcharge)}</strong>`
      : ""
  }${
    d.discountAmount > 0
      ? ` • Discount (−${d.discount_pct}%): <strong style="color:#f87171">−${fmtCurrency(
          d.discountAmount
        )}</strong>`
      : ""
  }</span>
        <span>Net Quote: <strong>${fmtCurrency(d.netClientPrice)}</strong></span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Margin Auditor Verdict & Policy Guardrails</div>
      <div class="gauge-wrap">
        <div class="gauge-header">
          <span>Gross Margin: <strong style="color:${marginColor}">${fmtPct(
    d.grossMarginPct
  )}</strong></span>
          <span style="color:#f59e0b">Floor: ${d.min_margin_pct}%</span>
        </div>
        <div class="gauge-track">
          <div class="gauge-fill"></div>
          <div class="gauge-floor"></div>
        </div>
      </div>
      ${violationsHtml}
    </div>
  </div>

  <div class="footer">
    <span>Generated by QuoteCraft on Switch • Roles: solutions-scoper + margin-auditor</span>
    <span>Date: ${d.date} • Human Gate: Agency Owner Sign-Off Required</span>
  </div>
</body>
</html>`;
}

function buildPdfHtml(d) {
  const rowsHtml = d.items
    .map(
      (i, idx) => `
      <tr>
        <td>${idx + 1}. <strong>${i.deliverable}</strong><div class="sub">${
        i.role
      }</div></td>
        <td class="num">${i.hours} hrs</td>
        <td class="num">${fmtCurrency(i.listRate)}/hr</td>
        <td class="num"><strong>${fmtCurrency(i.listPrice)}</strong></td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    color: #0f172a;
    padding: 48px 56px;
    line-height: 1.5;
  }
  .top {
    display: flex;
    justify-content: space-between;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  .agency { font-size: 22px; font-weight: 800; color: #0f172a; }
  .meta { text-align: right; font-size: 13px; color: #475569; }
  h1 { font-size: 26px; font-weight: 800; margin-bottom: 6px; }
  .summary { font-size: 14px; color: #334155; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px; }
  th {
    background: #f1f5f9;
    text-align: left;
    padding: 10px 12px;
    font-size: 12px;
    text-transform: uppercase;
    color: #475569;
    border-bottom: 1px solid #cbd5e1;
  }
  th.num, td.num { text-align: right; }
  td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
  .sub { font-size: 12px; color: #64748b; }
  .summary-box {
    margin-left: auto;
    width: 340px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 28px;
  }
  .s-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
  .s-total {
    display: flex;
    justify-content: space-between;
    font-size: 18px;
    font-weight: 800;
    border-top: 1px solid #94a3b8;
    padding-top: 10px;
    margin-top: 8px;
  }
  .terms {
    background: #f8fafc;
    border-left: 4px solid #0284c7;
    padding: 14px 18px;
    font-size: 13px;
    margin-bottom: 32px;
  }
  .sig {
    margin-top: 40px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    font-size: 13px;
    color: #475569;
  }
  .sig-line {
    border-top: 1px solid #94a3b8;
    padding-top: 8px;
    margin-top: 36px;
  }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="agency">${d.agency_name}</div>
      <div style="font-size:13px;color:#64748b">Statement of Work & Commercial Quote</div>
    </div>
    <div class="meta">
      <div><strong>Quote ID:</strong> ${d.quote_id}</div>
      <div><strong>Date:</strong> ${d.date}</div>
      <div><strong>Prepared For:</strong> ${d.client_name} (${d.client_contact})</div>
    </div>
  </div>

  <h1>${d.project_title}</h1>
  <p class="summary">${d.summary}</p>

  <table>
    <thead>
      <tr>
        <th>Deliverable & Scope</th>
        <th class="num">Estimated Hours</th>
        <th class="num">Rate</th>
        <th class="num">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="summary-box">
    <div class="s-row"><span>Subtotal (Standard Rate)</span><span>${fmtCurrency(
      d.subtotalListPrice
    )}</span></div>
    ${
      d.rushSurcharge > 0
        ? `<div class="s-row"><span>Expedited Rush SLA (+${d.rush_fee_pct}%)</span><span>+${fmtCurrency(
            d.rushSurcharge
          )}</span></div>`
        : ""
    }
    ${
      d.discountAmount > 0
        ? `<div class="s-row"><span>Partner Discount (−${d.discount_pct}%)</span><span>−${fmtCurrency(
            d.discountAmount
          )}</span></div>`
        : ""
    }
    <div class="s-total"><span>Total Investment</span><span>${fmtCurrency(
      d.netClientPrice
    )}</span></div>
  </div>

  <div class="terms">
    <strong>Delivery & Commercial Terms</strong><br/>
    • <strong>Target Turnaround:</strong> ${d.delivery_days} business days from kickoff and deposit receipt.<br/>
    • <strong>Included Revisions:</strong> Up to ${
      d.revision_rounds
    } consolidated rounds of revisions.<br/>
    • <strong>Payment Schedule:</strong> ${d.payment_terms}.
  </div>

  <div class="sig">
    <div>
      <strong>Approved by ${d.agency_name}:</strong>
      <div class="sig-line">${
        d.approved_by ? `Signed off by ${d.approved_by}` : "Authorized Agency Representative"
      } • ${d.date}</div>
    </div>
    <div>
      <strong>Accepted by ${d.client_name}:</strong>
      <div class="sig-line">${d.client_contact} • Date</div>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node render_quote.mjs <deal.json> [--out-dir ./out] [--rate-card ./rate-card.json] [--check]"
    );
    process.exit(1);
  }
  const inputPath = path.resolve(args[0]);
  const rateIdx = args.indexOf("--rate-card");
  const rateCardPath = path.resolve(
    rateIdx !== -1 && args[rateIdx + 1]
      ? args[rateIdx + 1]
      : path.join(__dirname, "rate-card.json")
  );
  const checkOnly = args.includes("--check");
  const outIdx = args.indexOf("--out-dir");
  const outDir = path.resolve(
    outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : "./out"
  );

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const rateCard = JSON.parse(fs.readFileSync(rateCardPath, "utf8"));
  const computed = computeDeal(raw, rateCard);

  if (checkOnly) {
    console.log(JSON.stringify(computed, null, 2));
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const computedPath = path.join(outDir, "computed-deal.json");
  fs.writeFileSync(computedPath, JSON.stringify(computed, null, 2));

  const { chromium } = await import("playwright");
  const t0 = Date.now();
  const executablePath = findBrowserExecutable();
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 760 },
      deviceScaleFactor: 2,
    });
    await page.setContent(buildCardHtml(computed), { waitUntil: "load" });
    const cardPath = path.join(outDir, "quote-card.png");
    await page.screenshot({ path: cardPath, fullPage: true });

    await page.setContent(buildPdfHtml(computed), { waitUntil: "load" });
    const pdfPath = path.join(outDir, "quote-proposal.pdf");
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
    });

    const elapsedMs = Date.now() - t0;
    console.log(
      JSON.stringify({
        status: computed.status,
        net_client_price: computed.netClientPrice,
        internal_cost: computed.totalInternalCost,
        gross_margin_pct: computed.grossMarginPct,
        violations_count: computed.violations.length,
        card_png: cardPath,
        proposal_pdf: pdfPath,
        computed_json: computedPath,
        elapsed_ms: elapsedMs,
      })
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
