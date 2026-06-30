// sync-weekly-activity — current-week health color + activity metrics.
//
// Ports the VERIFIED SQL from the vault (director_report.py / backfill_weekly_metrics.py).
// SUPABASE-SYNC-CRON-SPEC Job 3. Writes weekly_health_snapshots, on_conflict=(lab_name,week_start).
//
// RULINGS baked in (2026-06-30):
//  • Week = SAT–FRI (Doc's convention), NOT the Python's Monday week. ⇒ a one-time
//    recompute/reconciliation of existing Monday-based rows is expected (see PHASE2 doc).
//  • Org linkage = organizations.hubspot_company_id DB column (+ lab_assignments roster),
//    NOT the Python's Active-Organizations CSV.
//  • Login attribution uses authentication_prod.sessions (real sessions), staff-excluded
//    with the NULL-guarded clause (keeps coaches/directors with no email).
//
// ⚠️ Heaviest port; NOT yet run. This duplicates Doc's working Python — the spec
// mandates a parity/recompute check before trusting (docs/PHASE2-SYNC-DEPLOY.md).
//
// Timezone caveat: the Python ran naive-local; Edge runs UTC. Week boundaries +
// "days since" are computed in UTC here — confirm against historical numbers.

import { queryAthena, inList } from "../_shared/athena.ts";
import { supaService, upsert, recordRun } from "../_shared/db.ts";
import { alertSlack } from "../_shared/slack.ts";

const JOB = "sync-weekly-activity";
const DAY_MS = 86_400_000;

// Verified-assessment predicate (verbatim from the vault SQL).
const VERIFY =
  "(requires_admin_verification = 0 OR verified_by_admin_id IS NOT NULL) AND (requires_coach_verification = 0 OR verified_by_coach_id IS NOT NULL)";
// Staff exclusion — NULL-guarded form (director_report._staff_not_like, fixed 2026-06-22).
function staffClause(col: string): string {
  const pats = ["@universalspeedrating.com", "@lesspellman.com", "@bxcpartners.com"];
  const notLike = pats.map((p) => `${col} NOT LIKE '%${p}'`).join(" AND ");
  return `((${notLike}) OR ${col} IS NULL)`;
}
function colorFor(days: number | null): string {
  if (days === null) return "red";
  if (days <= 7) return "green";
  if (days <= 30) return "yellow";
  if (days <= 90) return "orange";
  return "red";
}
// Sat–Fri week containing `now` (UTC). weekStart = most recent Saturday 00:00.
function satFriWeek(now: Date) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceSat = (d.getUTCDay() + 1) % 7; // Sat=6 → 0
  const start = new Date(d.getTime() - daysSinceSat * DAY_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const ts = (x: Date) => `${x.toISOString().slice(0, 10)} 00:00:00`;
  return { weekStart: start.toISOString().slice(0, 10), startTs: ts(start), endTs: ts(end) };
}

// Sum a {key->count} from rows of [keyCol, cntCol].
function countMap(rows: Record<string, unknown>[], keyCol: string, cntCol = "cnt"): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[keyCol]), Number(r[cntCol] ?? 0));
  return m;
}

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  const { weekStart, startTs, endTs } = satFriWeek(new Date());
  try {
    // 1. Roster: lab_name + director_id (Supabase UUID) + company id (one read).
    const roster = await supaService(
      "lab_assignments?select=lab_name,director_id,hubspot_company_id&active=eq.true",
    ) as Array<{ lab_name: string; director_id: string | null; hubspot_company_id: string | null }>;
    const labs = roster.filter((r) => r.hubspot_company_id);
    if (!labs.length) {
      await recordRun(JOB, "success", 0, startedAt);
      return new Response(JSON.stringify({ job: JOB, week: weekStart, labs: 0 }), { status: 200 });
    }
    const companyIds = [...new Set(labs.map((l) => l.hubspot_company_id!))];

    // 2. company → org → communities (DB-column linkage).
    const orgs = await queryAthena(
      "organizations_prod",
      `SELECT CAST(id AS VARCHAR) id, CAST(hubspot_company_id AS VARCHAR) hubspot_company_id
       FROM organizations WHERE deleted_at IS NULL AND CAST(hubspot_company_id AS VARCHAR) IN (${inList(companyIds)})`,
      { label: "orgs" },
    ) as Array<{ id: string; hubspot_company_id: string }>;
    const orgByCompany = new Map(orgs.map((o) => [o.hubspot_company_id, o.id]));
    const orgIds = [...new Set(orgs.map((o) => o.id))];

    const ocm = orgIds.length
      ? await queryAthena(
        "organizations_prod",
        `SELECT CAST(organization_id AS VARCHAR) organization_id, CAST(community_id AS VARCHAR) community_id
         FROM organization_community_map WHERE organization_id IN (${inList(orgIds)}) AND deleted_at IS NULL`,
        { label: "communities" },
      ) as Array<{ organization_id: string; community_id: string }>
      : [];
    const commsByOrg = new Map<string, string[]>();
    for (const r of ocm) (commsByOrg.get(r.organization_id) ?? commsByOrg.set(r.organization_id, []).get(r.organization_id)!).push(r.community_id);
    const allComms = [...new Set(ocm.map((r) => r.community_id))];

    // 3. Login attribution ids: directors (by org) + coaches (by community), staff-excluded.
    const dirRows = orgIds.length
      ? await queryAthena(
        "organizations_prod",
        `SELECT CAST(odm.organization_id AS VARCHAR) organization_id, CAST(d.id AS VARCHAR) director_id
         FROM directors d JOIN organization_director_map odm ON odm.director_id = d.id
         WHERE odm.organization_id IN (${inList(orgIds)}) AND ${staffClause("d.email")}`,
        { label: "director-ids" },
      ) as Array<{ organization_id: string; director_id: string }>
      : [];
    const coachRows = allComms.length
      ? await queryAthena(
        "spellman_prod",
        `SELECT CAST(ccc.community_id AS VARCHAR) community_id, CAST(cc.id AS VARCHAR) coach_id
         FROM community_coaches cc JOIN community_community_coach ccc ON ccc.community_coach_id = cc.id
         WHERE ccc.community_id IN (${inList(allComms)}) AND ${staffClause("cc.email")}`,
        { label: "coach-ids" },
      ) as Array<{ community_id: string; coach_id: string }>
      : [];
    const directorIds = [...new Set(dirRows.map((r) => r.director_id))];
    const coachIds = [...new Set(coachRows.map((r) => r.coach_id))];

    // 4. Metric pulls for the week window (verbatim SQL).
    const idl = inList(allComms);
    const [dataPts, athletes, recaps, lastAct, prs] = await Promise.all([
      allComms.length ? queryAthena("assessments_prod",
        `SELECT CAST(community_id AS VARCHAR), COUNT(*) AS cnt FROM assessments WHERE community_id IN (${idl}) AND deleted_at IS NULL AND ${VERIFY} AND created_at >= TIMESTAMP '${startTs}' AND created_at < TIMESTAMP '${endTs}' GROUP BY community_id`, { label: "datapts" }) : [],
      allComms.length ? queryAthena("spellman_prod",
        `SELECT CAST(community_id AS VARCHAR), COUNT(*) AS cnt FROM community_user WHERE community_id IN (${idl}) AND deleted_at IS NULL AND created_at >= TIMESTAMP '${startTs}' AND created_at < TIMESTAMP '${endTs}' GROUP BY community_id`, { label: "athletes" }) : [],
      allComms.length ? queryAthena("assessments_prod",
        `SELECT CAST(community_id AS VARCHAR), COUNT(*) AS cnt FROM assessment_reports WHERE community_id IN (${idl}) AND deleted_at IS NULL AND created_at >= TIMESTAMP '${startTs}' AND created_at < TIMESTAMP '${endTs}' GROUP BY community_id`, { label: "recaps" }) : [],
      allComms.length ? queryAthena("assessments_prod",
        `SELECT community_id, MAX(CAST(session_date AS VARCHAR)) as last_activity FROM assessments WHERE community_id IN (${idl}) AND deleted_at IS NULL AND ${VERIFY} GROUP BY community_id`, { label: "last-activity" }) : [],
      allComms.length ? queryAthena("assessments_prod",
        `WITH recent AS (SELECT a.community_id, a.athlete_id, ac.type, MAX(a.aggregated_value) recent_max, MIN(a.aggregated_value) recent_min FROM assessments a JOIN assessment_configs ac ON a.config_id = ac.id WHERE a.community_id IN (${idl}) AND a.deleted_at IS NULL AND ac.type <> 'CUSTOM' AND a.session_date >= TIMESTAMP '${startTs}' AND a.session_date < TIMESTAMP '${endTs}' AND ${VERIFY.replace(/requires_/g, "a.requires_").replace(/verified_/g, "a.verified_")} GROUP BY a.community_id, a.athlete_id, ac.type), prior AS (SELECT a.community_id, a.athlete_id, ac.type, MAX(a.aggregated_value) prior_max, MIN(a.aggregated_value) prior_min FROM assessments a JOIN assessment_configs ac ON a.config_id = ac.id WHERE a.community_id IN (${idl}) AND a.deleted_at IS NULL AND ac.type <> 'CUSTOM' AND a.session_date < TIMESTAMP '${startTs}' AND ${VERIFY.replace(/requires_/g, "a.requires_").replace(/verified_/g, "a.verified_")} GROUP BY a.community_id, a.athlete_id, ac.type) SELECT CAST(r.community_id AS VARCHAR), COUNT(*) prs FROM recent r LEFT JOIN prior p ON r.community_id = p.community_id AND r.athlete_id = p.athlete_id AND r.type = p.type WHERE (r.type IN ('SHUTTLE_5_10_5','SPLIT_TIME') AND (p.prior_min IS NULL OR r.recent_min < p.prior_min)) OR (r.type NOT IN ('SHUTTLE_5_10_5','SPLIT_TIME') AND r.recent_max > COALESCE(p.prior_max, 0)) GROUP BY r.community_id`, { label: "prs", timeoutMs: 120_000 }) : [],
    ]);

    // 5. Logins: sessions for the attributed director/coach ids in the window.
    const loginConds: string[] = [];
    if (directorIds.length) loginConds.push(`(user_type = 'director' AND CAST(user_id AS VARCHAR) IN (${inList(directorIds)}))`);
    if (coachIds.length) loginConds.push(`(user_type = 'coach' AND CAST(user_id AS VARCHAR) IN (${inList(coachIds)}))`);
    const sessions = loginConds.length
      ? await queryAthena("authentication_prod",
        `SELECT user_type, CAST(user_id AS VARCHAR) AS user_id, COUNT(*) AS sessions FROM sessions WHERE (${loginConds.join(" OR ")}) AND CAST(created_at AS TIMESTAMP) >= TIMESTAMP '${startTs}' AND CAST(created_at AS TIMESTAMP) < TIMESTAMP '${endTs}' GROUP BY user_type, user_id`, { label: "logins", timeoutMs: 120_000 })
      : [] as Record<string, unknown>[];
    const sessByUser = new Map<string, number>(); // `${type}:${id}` -> count
    for (const s of sessions) sessByUser.set(`${s.user_type}:${s.user_id}`, Number(s.sessions ?? 0));

    const dataPtsM = countMap(dataPts, "community_id"), athletesM = countMap(athletes, "community_id"),
      recapsM = countMap(recaps, "community_id"), prsM = countMap(prs as Record<string, unknown>[], "community_id", "prs");
    const lastActM = new Map<string, string>();
    for (const r of lastAct as Record<string, unknown>[]) if (r.last_activity) lastActM.set(String(r.community_id), String(r.last_activity).slice(0, 10));
    const dirsByOrg = new Map<string, string[]>();
    for (const r of dirRows) (dirsByOrg.get(r.organization_id) ?? dirsByOrg.set(r.organization_id, []).get(r.organization_id)!).push(r.director_id);
    const coachesByComm = new Map<string, string[]>();
    for (const r of coachRows) (coachesByComm.get(r.community_id) ?? coachesByComm.set(r.community_id, []).get(r.community_id)!).push(r.coach_id);

    // 6. Assemble one snapshot row per lab.
    const now = Date.now();
    const rows = labs.map((lab) => {
      const org = orgByCompany.get(lab.hubspot_company_id!);
      const comms = org ? (commsByOrg.get(org) ?? []) : [];
      const sum = (m: Map<string, number>) => comms.reduce((n, c) => n + (m.get(c) ?? 0), 0);

      // last activity across the lab's communities → color (reference = now, current week).
      let lastIso: string | null = null;
      for (const c of comms) {
        const v = lastActM.get(c);
        if (v && (!lastIso || v > lastIso)) lastIso = v;
      }
      const days = lastIso ? Math.floor((now - new Date(`${lastIso}T00:00:00Z`).getTime()) / DAY_MS) : null;

      // logins = sessions of this lab's directors (by org) + coaches (by communities).
      const dirSess = (org ? (dirsByOrg.get(org) ?? []) : []).reduce((n, id) => n + (sessByUser.get(`director:${id}`) ?? 0), 0);
      const coachSess = comms.flatMap((c) => coachesByComm.get(c) ?? []).reduce((n, id) => n + (sessByUser.get(`coach:${id}`) ?? 0), 0);

      return {
        director_id: lab.director_id,
        lab_name: lab.lab_name,
        week_start: weekStart,
        health_color: org ? colorFor(days) : "unknown",
        days_since_activity: days,
        last_activity_date: lastIso,
        org_id: org ?? null,
        logins_week: dirSess + coachSess,
        data_pts_week: sum(dataPtsM),
        prs_week: sum(prsM),
        athletes_added_week: sum(athletesM),
        recaps_week: sum(recapsM),
        trigger_type: "cron",
      };
    });

    await upsert("weekly_health_snapshots", rows, "lab_name,week_start");
    await recordRun(JOB, "success", rows.length, startedAt);
    return new Response(JSON.stringify({ job: JOB, week: weekStart, labs: rows.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await recordRun(JOB, "error", 0, startedAt, e instanceof Error ? e.message : String(e));
    await alertSlack(JOB, e);
    return new Response(JSON.stringify({ job: JOB, error: String(e) }), { status: 500 });
  }
});
