// sync-hubspot-deals — HubSpot active Speed Lab deals → lab_accounts.
//
// Deno/TS port of netlify/functions/hubspot-sync.js (SUPABASE-SYNC-CRON-SPEC Job 1).
// Per the spec, THIS becomes the single source of the deal pull; the dashboard
// "Refresh now" button should be repointed here (don't keep a 2nd copy in Netlify).
//
// Difference vs. the Netlify version: no per-request admin gate. This runs under
// the service role (pg_cron / an admin-only invoke). If you wire the button to it,
// gate the invocation (verify_jwt + is_admin) at the edge, not per-row.
//
// Identity model preserved EXACTLY: one row per customer (dedup by HubSpot company),
// upsert keyed on deal_id, churn = flagged-not-deleted. Same lab_accounts columns.
// Env (Supabase Vault): HUBSPOT_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { supaService, recordRun } from "../_shared/db.ts";
import { alertSlack } from "../_shared/slack.ts";

const JOB = "sync-hubspot-deals";
const HS = "https://api.hubapi.com";
const HS_TOKEN = Deno.env.get("HUBSPOT_ACCESS_TOKEN")!;

const PIPELINE_ID = "64911390";
const CLOSED_WON = "132311327";
const CLOSED_LOST = "132311328";
const STAGE_LABELS: Record<string, string> = {
  "126902544": "On Deck", "126902545": "Level Set", "126902546": "First 30 Days",
  "128794704": "First 90 Days", "126902547": "Months 4-7", "126890754": "Upcoming Renewals",
  "132288808": "Renewals this Quarter", "132311327": "Closed Won", "132311328": "Closed Lost",
};
const DEAL_PROPS = [
  "dealname", "dealstage", "contract_end_date", "product", "contract_start_date",
  "contract_year", "renewal_status", "speed_lab_status", "churn_risk",
  "customer_segement", "payment_status", "speed_lab_director", "arr_amount",
  "amount", "payment_update", "payment_processor", "overdue_amount",
  "onboarding_cohort", "removed_access_from_usr", "speed_lab_level", "years_as_a_speed_lab",
  "createdate",
];
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const toNumber = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

async function hsFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${HS}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${HS_TOKEN}`, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`HubSpot ${opts.method || "GET"} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function fetchActiveDeals(): Promise<Array<{ id: string; properties: Record<string, string> }>> {
  const common = [
    { propertyName: "pipeline", operator: "EQ", value: PIPELINE_ID },
    { propertyName: "dealstage", operator: "NOT_IN", values: [CLOSED_WON, CLOSED_LOST] },
  ];
  const base = {
    filterGroups: [
      { filters: [...common, { propertyName: "renewal_status", operator: "NEQ", value: "Churned" }] },
      { filters: [...common, { propertyName: "renewal_status", operator: "NOT_HAS_PROPERTY" }] },
    ],
    properties: DEAL_PROPS,
    sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    limit: 100,
  };
  const deals: Array<{ id: string; properties: Record<string, string> }> = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const body = after ? { ...base, after } : base;
    const data = await hsFetch("/crm/v3/objects/deals/search", { method: "POST", body: JSON.stringify(body) });
    deals.push(...(data.results || []));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return deals;
}

async function fetchDealCompanies(dealIds: string[]): Promise<Record<string, string> & { __error?: string }> {
  const map: Record<string, string> = {};
  try {
    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100);
      const data = await hsFetch("/crm/v4/associations/deals/companies/batch/read", {
        method: "POST",
        body: JSON.stringify({ inputs: chunk.map((id) => ({ id: String(id) })) }),
      });
      for (const r of (data.results || [])) {
        const from = String(r.from?.id ?? "");
        const to = r.to?.[0]?.toObjectId ?? r.to?.[0]?.id;
        if (from && to != null) map[from] = String(to);
      }
    }
  } catch (e) {
    return { __error: String((e as Error).message || e) };
  }
  return map;
}

function mapDealToRow(d: { id: string; properties: Record<string, string> }, companyId: string | null) {
  const p = d.properties || {};
  const stage = p.dealstage;
  return {
    lab_name: (p.dealname || "").trim() || "(unnamed customer)",
    deal_id: String(d.id),
    hubspot_company_id: companyId || null,
    is_active: true,
    churn_flagged: false,
    churn_flagged_at: null,
    renewal_date: dateOnly(p.contract_end_date),
    deal_stage: stage,
    deal_stage_label: STAGE_LABELS[stage] || stage,
    product: p.product ?? null,
    contract_start_date: dateOnly(p.contract_start_date),
    contract_year: p.contract_year ?? null,
    renewal_status: p.renewal_status ?? null,
    speed_lab_status: p.speed_lab_status ?? null,
    churn_risk: p.churn_risk ?? null,
    customer_segment: p.customer_segement ?? null, // HubSpot misspelling
    payment_status: p.payment_status ?? null,
    speed_lab_director: p.speed_lab_director ?? null,
    arr_amount: toNumber(p.arr_amount),
    amount: toNumber(p.amount),
    payment_update: p.payment_update ?? null,
    payment_processor: p.payment_processor ?? null,
    overdue_amount: toNumber(p.overdue_amount),
    onboarding_cohort: p.onboarding_cohort ?? null,
    removed_access_from_usr: p.removed_access_from_usr ?? null,
    speed_lab_level: p.speed_lab_level ?? null,
    years_as_a_speed_lab: p.years_as_a_speed_lab ?? null,
  };
}

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  try {
    const deals = await fetchActiveDeals();
    const companyOf = await fetchDealCompanies(deals.map((d) => d.id));
    const assocDegraded = !!companyOf.__error;

    // Group by company; canonical = most-recent createdate.
    const groups: Record<string, Array<{ d: typeof deals[number]; cid: string | null }>> = {};
    for (const d of deals) {
      const cid = assocDegraded ? null : (companyOf[String(d.id)] || null);
      const key = cid ? `c:${cid}` : `d:${d.id}`;
      (groups[key] = groups[key] || []).push({ d, cid });
    }
    const rows = Object.keys(groups).map((key) => {
      const arr = groups[key].sort((a, b) =>
        String(b.d.properties?.createdate || "").localeCompare(String(a.d.properties?.createdate || "")));
      return mapDealToRow(arr[0].d, arr[0].cid);
    });

    // Upsert roster (merge on deal_id — preserves existing enrichment).
    for (let i = 0; i < rows.length; i += 100) {
      await supaService("lab_accounts?on_conflict=deal_id", "POST", rows.slice(i, i + 100), "resolution=merge-duplicates,return=minimal");
    }

    // Churn sweep: flag previously-active rows no longer in the roster (never delete).
    let flagged = 0;
    const rosterIds = rows.map((r) => r.deal_id);
    if (rosterIds.length) {
      const patched = await supaService(
        `lab_accounts?is_active=eq.true&churn_flagged=eq.false&deal_id=not.in.(${rosterIds.join(",")})`,
        "PATCH",
        { churn_flagged: true, churn_flagged_at: startedAt },
        "return=representation",
      ) as unknown[] | null;
      flagged = Array.isArray(patched) ? patched.length : 0;
    }

    await recordRun(JOB, "success", rows.length, startedAt,
      assocDegraded ? `company grouping degraded: ${companyOf.__error}; ${flagged} churn-flagged` : undefined);
    return new Response(JSON.stringify({ job: JOB, customers: rows.length, deals: deals.length, flagged, assocDegraded }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await recordRun(JOB, "error", 0, startedAt, e instanceof Error ? e.message : String(e));
    await alertSlack(JOB, e);
    return new Response(JSON.stringify({ job: JOB, error: String(e) }), { status: 500 });
  }
});
