// sync-ttv — per-customer, kickoff-anchored Time-To-Value.
//
// TTV rule (Brock-confirmed): a lab passes when it logs >= 5 assessment_reports
// within a 7-DAY WINDOW that starts on the MANUALLY-SET kickoff_date (set in the
// dashboard so the clock starts on the right trigger — not a calendar week).
//
// Definition (ported from the live sync_ttv definition; D8):
//   • count assessments_prod.assessment_reports by created_at within
//     [kickoff_date, kickoff_date + 7d)
//   • deleted_at IS NULL; ALL sources/types; no verification filter
// Org linkage uses the DB column organizations.hubspot_company_id (Brock's choice),
// joined to lab_accounts (deal_id <-> hubspot_company_id) — no CSV dependency.
//
// Writes onboarding_ttv(deal_id, status, days_to_five, recaps_in_window). The app's
// effectiveTtv() reads recaps_in_window + status; a manual ttv_status_override in
// onboarding_cs still wins in the UI, so this never fights a human pass/fail call.
//
// Deploy + verify: see docs/PHASE2-SYNC-DEPLOY.md. NOT YET RUN against prod.

import { queryAthena, inList } from "../_shared/athena.ts";
import { supaService, upsert, recordRun } from "../_shared/db.ts";
import { alertSlack } from "../_shared/slack.ts";

const JOB = "sync-ttv";
const TTV_TARGET = 5;
const TTV_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  try {
    // 1. Cohort: onboarding deals with a manually-set kickoff_date.
    const cs = await supaService(
      "onboarding_cs?select=deal_id,kickoff_date&kickoff_date=not.is.null",
    ) as Array<{ deal_id: string; kickoff_date: string }>;
    if (!cs.length) {
      await recordRun(JOB, "success", 0, startedAt);
      return new Response(JSON.stringify({ job: JOB, deals: 0 }), { status: 200 });
    }

    // 2. deal_id -> hubspot_company_id (from the synced roster).
    const dealIds = cs.map((r) => r.deal_id);
    const labs = await supaService(
      `lab_accounts?select=deal_id,hubspot_company_id&deal_id=in.(${dealIds.join(",")})`,
    ) as Array<{ deal_id: string; hubspot_company_id: string | null }>;
    const companyByDeal = new Map(labs.map((l) => [l.deal_id, l.hubspot_company_id]));
    const companyIds = [...new Set(labs.map((l) => l.hubspot_company_id).filter(Boolean))] as string[];
    if (!companyIds.length) {
      await recordRun(JOB, "success", 0, startedAt);
      return new Response(JSON.stringify({ job: JOB, deals: 0, note: "no company ids" }), { status: 200 });
    }

    // 3. hubspot_company_id -> org id (DB column linkage, Brock's choice).
    const orgs = await queryAthena(
      "organizations_prod",
      `SELECT CAST(id AS VARCHAR) AS id, CAST(hubspot_company_id AS VARCHAR) AS hubspot_company_id
       FROM organizations
       WHERE deleted_at IS NULL AND CAST(hubspot_company_id AS VARCHAR) IN (${inList(companyIds)})`,
      { label: "org-by-company" },
    ) as Array<{ id: string; hubspot_company_id: string }>;
    const orgByCompany = new Map<string, string>();
    for (const o of orgs) orgByCompany.set(o.hubspot_company_id, o.id);

    // 4. org id -> community ids.
    const orgIds = [...new Set(orgs.map((o) => o.id))];
    const comms = orgIds.length
      ? await queryAthena(
        "organizations_prod",
        `SELECT CAST(organization_id AS VARCHAR) AS organization_id, CAST(community_id AS VARCHAR) AS community_id
         FROM organization_community_map
         WHERE organization_id IN (${inList(orgIds)}) AND deleted_at IS NULL`,
        { label: "communities" },
      ) as Array<{ organization_id: string; community_id: string }>
      : [];
    const commsByOrg = new Map<string, string[]>();
    for (const c of comms) {
      const arr = commsByOrg.get(c.organization_id) ?? [];
      arr.push(c.community_id);
      commsByOrg.set(c.organization_id, arr);
    }

    // deal -> [community ids]
    const commsByDeal = new Map<string, string[]>();
    for (const { deal_id } of cs) {
      const company = companyByDeal.get(deal_id);
      const org = company ? orgByCompany.get(company) : undefined;
      commsByDeal.set(deal_id, org ? (commsByOrg.get(org) ?? []) : []);
    }

    // 5. One report pull for all cohort communities from the earliest kickoff.
    const allComms = [...new Set([...commsByDeal.values()].flat())];
    const minKickoff = cs.reduce((min, r) => (r.kickoff_date < min ? r.kickoff_date : min), cs[0].kickoff_date);
    const reports = allComms.length
      ? await queryAthena(
        "assessments_prod",
        `SELECT CAST(community_id AS VARCHAR) AS community_id, CAST(created_at AS VARCHAR) AS created_at
         FROM assessment_reports
         WHERE community_id IN (${inList(allComms)})
           AND deleted_at IS NULL
           AND created_at >= TIMESTAMP '${minKickoff} 00:00:00'`,
        { label: "recaps" },
      ) as Array<{ community_id: string; created_at: string }>
      : [];
    const reportsByComm = new Map<string, number[]>(); // community_id -> [created_at epoch ms]
    for (const r of reports) {
      const t = new Date(r.created_at.replace(" ", "T")).getTime();
      if (Number.isNaN(t)) continue;
      const arr = reportsByComm.get(r.community_id) ?? [];
      arr.push(t);
      reportsByComm.set(r.community_id, arr);
    }

    // 6. Per deal: count recaps in [kickoff, kickoff+7d), derive status + days_to_five.
    const now = Date.now();
    const rows = cs.map(({ deal_id, kickoff_date }) => {
      const start = new Date(`${kickoff_date}T00:00:00`).getTime();
      const end = start + TTV_WINDOW_DAYS * DAY_MS;
      const times = (commsByDeal.get(deal_id) ?? [])
        .flatMap((cid) => reportsByComm.get(cid) ?? [])
        .filter((t) => t >= start && t < end)
        .sort((a, b) => a - b);
      const recaps = times.length;

      let status: string;
      let days_to_five: number | null = null;
      if (recaps >= TTV_TARGET) {
        status = "passed";
        days_to_five = Math.max(1, Math.ceil((times[TTV_TARGET - 1] - start) / DAY_MS));
      } else if (now < end) {
        status = "in_progress"; // window still open
      } else {
        status = "review"; // window elapsed, <5 — needs a human pass/fail call
      }
      return { deal_id, status, days_to_five, recaps_in_window: recaps };
    });

    await upsert("onboarding_ttv", rows, "deal_id");
    await recordRun(JOB, "success", rows.length, startedAt);
    return new Response(JSON.stringify({ job: JOB, deals: rows.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await recordRun(JOB, "error", 0, startedAt, e instanceof Error ? e.message : String(e));
    await alertSlack(JOB, e);
    return new Response(JSON.stringify({ job: JOB, error: String(e) }), { status: 500 });
  }
});
