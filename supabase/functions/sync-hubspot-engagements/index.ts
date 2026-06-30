// sync-hubspot-engagements — HubSpot notes + meetings → hs_engagements.
//
// SUPABASE-SYNC-CRON-SPEC Job 2 / Q6. Deal-grain associations; 12-month backfill on
// first run, then incremental by hs_lastmodifieddate. Includes upcoming/scheduled
// meetings (future-dated) for call prep. Stores full note/meeting body as HTML
// (sanitize on render). Read-only mirror — never written back to HubSpot.
//
// Env (Supabase Vault): HUBSPOT_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// NOT yet run — verify against a couple of known deals before trusting (see PHASE2 doc).

import { supaService, upsert, recordRun } from "../_shared/db.ts";
import { alertSlack } from "../_shared/slack.ts";

const JOB = "sync-hubspot-engagements";
const HS = "https://api.hubapi.com";
const HS_TOKEN = Deno.env.get("HUBSPOT_ACCESS_TOKEN")!;
const DAY_MS = 86_400_000;
const BACKFILL_DAYS = 365;

const NOTE_PROPS = ["hs_note_body", "hs_timestamp", "hs_createdate", "hs_lastmodifieddate", "hubspot_owner_id"];
const MEETING_PROPS = ["hs_meeting_title", "hs_meeting_body", "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome", "hs_timestamp", "hs_lastmodifieddate", "hubspot_owner_id"];

async function hsFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${HS}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${HS_TOKEN}`, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`HubSpot ${opts.method || "GET"} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// deal -> [engagement ids] for a given engagement type, via v4 batch associations.
async function dealAssociations(dealIds: string[], toType: "notes" | "meetings"): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    const data = await hsFetch(`/crm/v4/associations/deals/${toType}/batch/read`, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id: String(id) })) }),
    });
    for (const r of (data.results || [])) {
      const from = String(r.from?.id ?? "");
      const ids = (r.to || []).map((t: { toObjectId?: string | number; id?: string | number }) => String(t.toObjectId ?? t.id)).filter(Boolean);
      if (from && ids.length) out.set(from, ids);
    }
  }
  return out;
}

// Batch-read engagement objects by id with the requested properties.
async function readObjects(type: "notes" | "meetings", ids: string[], props: string[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await hsFetch(`/crm/v3/objects/${type}/batch/read`, {
      method: "POST",
      body: JSON.stringify({ properties: props, inputs: chunk.map((id) => ({ id })) }),
    });
    for (const r of (data.results || [])) out.set(String(r.id), r.properties || {});
  }
  return out;
}

async function ownerNames(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let after: string | undefined;
  for (let p = 0; p < 20; p++) {
    const q = after ? `?limit=100&after=${after}` : "?limit=100";
    const data = await hsFetch(`/crm/v3/owners${q}`);
    for (const o of (data.results || [])) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.id);
      m.set(String(o.id), name);
    }
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return m;
}

const ms = (v: unknown) => {
  if (!v) return null;
  const t = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  try {
    // 1. Active deal ids (the association spine).
    const labs = await supaService("lab_accounts?select=deal_id&is_active=eq.true") as Array<{ deal_id: string }>;
    const dealIds = [...new Set(labs.map((l) => l.deal_id))];
    if (!dealIds.length) { await recordRun(JOB, "success", 0, startedAt); return new Response(JSON.stringify({ job: JOB, rows: 0 }), { status: 200 }); }

    // 2. Incremental watermark: newest hs_last_modified we already have.
    const latest = await supaService("hs_engagements?select=hs_last_modified&order=hs_last_modified.desc&limit=1") as Array<{ hs_last_modified: string | null }>;
    const since = latest?.[0]?.hs_last_modified ? Date.parse(latest[0].hs_last_modified) : null;
    const backfillFloor = Date.now() - BACKFILL_DAYS * DAY_MS;

    const owners = await ownerNames();
    const rows: Record<string, unknown>[] = [];

    for (const type of ["notes", "meetings"] as const) {
      const assoc = await dealAssociations(dealIds, type);
      // engagement id -> its deal (deal-grain: first associated active deal wins)
      const dealOf = new Map<string, string>();
      for (const [deal, engIds] of assoc) for (const e of engIds) if (!dealOf.has(e)) dealOf.set(e, deal);
      const engIds = [...dealOf.keys()];
      if (!engIds.length) continue;

      const props = type === "notes" ? NOTE_PROPS : MEETING_PROPS;
      const objs = await readObjects(type, engIds, props);

      for (const [id, p] of objs) {
        const lastMod = ms(p.hs_lastmodifieddate);
        const occurred = type === "notes"
          ? ms(p.hs_timestamp) ?? ms(p.hs_createdate)
          : ms(p.hs_meeting_start_time) ?? ms(p.hs_timestamp);
        if (!occurred) continue;
        // bound table to 12 months; on incremental runs only take changed rows.
        if (Date.parse(occurred) < backfillFloor) continue;
        if (since && lastMod && Date.parse(lastMod) <= since) continue;

        rows.push({
          engagement_id: Number(id),
          type: type === "notes" ? "note" : "meeting",
          deal_id: dealOf.get(id)!,
          owner_name: p.hubspot_owner_id ? (owners.get(String(p.hubspot_owner_id)) ?? null) : null,
          occurred_at: occurred,
          meeting_end: type === "meetings" ? ms(p.hs_meeting_end_time) : null,
          meeting_outcome: type === "meetings" ? (p.hs_meeting_outcome ?? null) : null,
          title: type === "meetings" ? (p.hs_meeting_title ?? null) : null,
          body_html: type === "notes" ? (p.hs_note_body ?? null) : (p.hs_meeting_body ?? null),
          hs_last_modified: lastMod,
          synced_at: startedAt,
        });
      }
    }

    for (let i = 0; i < rows.length; i += 200) {
      await upsert("hs_engagements", rows.slice(i, i + 200), "engagement_id");
    }
    await recordRun(JOB, "success", rows.length, startedAt, since ? "incremental" : "backfill-12mo");
    return new Response(JSON.stringify({ job: JOB, rows: rows.length, mode: since ? "incremental" : "backfill" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await recordRun(JOB, "error", 0, startedAt, e instanceof Error ? e.message : String(e));
    await alertSlack(JOB, e);
    return new Response(JSON.stringify({ job: JOB, error: String(e) }), { status: 500 });
  }
});
