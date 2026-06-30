// sync-monthly-health — current-month 0–9 health score + color stats.
//
// Ports the verified vault logic (backfill_monthly_health.py /
// director_report.write_monthly_health_to_supabase). SUPABASE-SYNC-CRON-SPEC Job 4.
// Runs AFTER sync-weekly-activity (reads weekly_health_snapshots for color stats).
// Writes monthly_health_snapshots, on_conflict=(lab_name,month).
//
// Score (0–9) = login_sub + athletes_sub + assessments_sub, each ∈ {0,1,3}:
//   green_week_count 0 → 0 ; 1–2 → 1 ; 3+ → 3   (a score of 2 never occurs).
// "green weeks" = distinct date_trunc('week') buckets (Monday-based, verbatim) with
// ≥1 qualifying event in the month. Staff-excluded (NULL-guarded). Logins via
// authentication_prod.sessions (not the last_login_at proxy).
//
// NOTE: the org/community/director/coach resolution mirrors sync-weekly-activity;
// factor into _shared/roster.ts once tests exist. NOT yet run — parity-check first.

import { queryAthena, inList } from "../_shared/athena.ts";
import { supaService, upsert, recordRun } from "../_shared/db.ts";
import { alertSlack } from "../_shared/slack.ts";

const JOB = "sync-monthly-health";
const VERIFY =
  "(requires_admin_verification = 0 OR verified_by_admin_id IS NOT NULL) AND (requires_coach_verification = 0 OR verified_by_coach_id IS NOT NULL)";
function staffClause(col: string): string {
  return `((${["@universalspeedrating.com", "@lesspellman.com", "@bxcpartners.com"].map((p) => `${col} NOT LIKE '%${p}'`).join(" AND ")}) OR ${col} IS NULL)`;
}
function subScore(weeks: number): number {
  if (weeks === 0) return 0;
  if (weeks <= 2) return 1;
  return 3;
}
function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
}

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthEnd = nextMonth.toISOString().slice(0, 10);
  const startTs = `${monthStart} 00:00:00`, endTs = `${monthEnd} 00:00:00`;

  try {
    // 1. Roster.
    const roster = await supaService(
      "lab_assignments?select=lab_name,director_id,hubspot_company_id&active=eq.true",
    ) as Array<{ lab_name: string; director_id: string | null; hubspot_company_id: string | null }>;
    const labs = roster.filter((r) => r.hubspot_company_id);
    if (!labs.length) { await recordRun(JOB, "success", 0, startedAt); return new Response(JSON.stringify({ job: JOB, month: monthStart, labs: 0 }), { status: 200 }); }
    const companyIds = [...new Set(labs.map((l) => l.hubspot_company_id!))];

    // 2. company → org → communities; + director/coach ids for login-weeks.
    const orgs = await queryAthena("organizations_prod",
      `SELECT CAST(id AS VARCHAR) id, CAST(hubspot_company_id AS VARCHAR) hubspot_company_id FROM organizations WHERE deleted_at IS NULL AND CAST(hubspot_company_id AS VARCHAR) IN (${inList(companyIds)})`, { label: "orgs" }) as Array<{ id: string; hubspot_company_id: string }>;
    const orgByCompany = new Map(orgs.map((o) => [o.hubspot_company_id, o.id]));
    const orgIds = [...new Set(orgs.map((o) => o.id))];
    const ocm = orgIds.length ? await queryAthena("organizations_prod",
      `SELECT CAST(organization_id AS VARCHAR) organization_id, CAST(community_id AS VARCHAR) community_id FROM organization_community_map WHERE organization_id IN (${inList(orgIds)}) AND deleted_at IS NULL`, { label: "communities" }) as Array<{ organization_id: string; community_id: string }> : [];
    const commsByOrg = new Map<string, string[]>(); for (const r of ocm) pushMap(commsByOrg, r.organization_id, r.community_id);
    const allComms = [...new Set(ocm.map((r) => r.community_id))];

    const dirRows = orgIds.length ? await queryAthena("organizations_prod",
      `SELECT CAST(odm.organization_id AS VARCHAR) organization_id, CAST(d.id AS VARCHAR) director_id FROM directors d JOIN organization_director_map odm ON odm.director_id = d.id WHERE odm.organization_id IN (${inList(orgIds)}) AND ${staffClause("d.email")}`, { label: "director-ids" }) as Array<{ organization_id: string; director_id: string }> : [];
    const coachRows = allComms.length ? await queryAthena("spellman_prod",
      `SELECT CAST(ccc.community_id AS VARCHAR) community_id, CAST(cc.id AS VARCHAR) coach_id FROM community_coaches cc JOIN community_community_coach ccc ON ccc.community_coach_id = cc.id WHERE ccc.community_id IN (${inList(allComms)}) AND ${staffClause("cc.email")}`, { label: "coach-ids" }) as Array<{ community_id: string; coach_id: string }> : [];
    const directorIds = [...new Set(dirRows.map((r) => r.director_id))];
    const coachIds = [...new Set(coachRows.map((r) => r.coach_id))];
    const dirsByOrg = new Map<string, string[]>(); for (const r of dirRows) pushMap(dirsByOrg, r.organization_id, r.director_id);
    const coachesByComm = new Map<string, string[]>(); for (const r of coachRows) pushMap(coachesByComm, r.community_id, r.coach_id);

    // 3. Week-bucketed activity within the month (date_trunc('week') = Monday, verbatim).
    const idl = inList(allComms);
    const loginConds: string[] = [];
    if (directorIds.length) loginConds.push(`(user_type = 'director' AND CAST(user_id AS VARCHAR) IN (${inList(directorIds)}))`);
    if (coachIds.length) loginConds.push(`(user_type = 'coach' AND CAST(user_id AS VARCHAR) IN (${inList(coachIds)}))`);
    const [loginWeeks, athleteWeeks, assessWeeks] = await Promise.all([
      loginConds.length ? queryAthena("authentication_prod",
        `SELECT user_type, CAST(user_id AS VARCHAR) AS uid, CAST(date_trunc('week', CAST(created_at AS TIMESTAMP)) AS VARCHAR) AS iso_week FROM sessions WHERE (${loginConds.join(" OR ")}) AND CAST(created_at AS TIMESTAMP) >= TIMESTAMP '${startTs}' AND CAST(created_at AS TIMESTAMP) < TIMESTAMP '${endTs}' GROUP BY user_type, user_id, date_trunc('week', CAST(created_at AS TIMESTAMP))`, { label: "login-weeks", timeoutMs: 120_000 }) : [] as Record<string, unknown>[],
      allComms.length ? queryAthena("spellman_prod",
        `SELECT CAST(cu.community_id AS VARCHAR) community_id, CAST(date_trunc('week', CAST(cu.created_at AS TIMESTAMP)) AS VARCHAR) iso_week FROM community_user cu WHERE CAST(cu.community_id AS VARCHAR) IN (${idl}) AND CAST(cu.created_at AS TIMESTAMP) >= TIMESTAMP '${startTs}' AND CAST(cu.created_at AS TIMESTAMP) < TIMESTAMP '${endTs}' GROUP BY cu.community_id, date_trunc('week', CAST(cu.created_at AS TIMESTAMP))`, { label: "athlete-weeks" }) : [] as Record<string, unknown>[],
      allComms.length ? queryAthena("assessments_prod",
        `SELECT CAST(community_id AS VARCHAR) community_id, CAST(date_trunc('week', CAST(session_date AS TIMESTAMP)) AS VARCHAR) iso_week FROM assessments WHERE CAST(community_id AS VARCHAR) IN (${idl}) AND CAST(session_date AS TIMESTAMP) >= TIMESTAMP '${startTs}' AND CAST(session_date AS TIMESTAMP) < TIMESTAMP '${endTs}' AND deleted_at IS NULL AND ${VERIFY} GROUP BY community_id, date_trunc('week', CAST(session_date AS TIMESTAMP))`, { label: "assessment-weeks" }) : [] as Record<string, unknown>[],
    ]);
    // Index week-buckets.
    const loginWeeksByUser = new Map<string, Set<string>>(); // `${type}:${uid}` -> weeks
    for (const r of loginWeeks) pushSet(loginWeeksByUser, `${r.user_type}:${r.uid}`, String(r.iso_week).slice(0, 10));
    const athWeeksByComm = new Map<string, Set<string>>();
    for (const r of athleteWeeks) pushSet(athWeeksByComm, String(r.community_id), String(r.iso_week).slice(0, 10));
    const assWeeksByComm = new Map<string, Set<string>>();
    for (const r of assessWeeks) pushSet(assWeeksByComm, String(r.community_id), String(r.iso_week).slice(0, 10));

    // 4. Color stats for the month from weekly_health_snapshots (Sat–Fri rows).
    const labNames = labs.map((l) => l.lab_name);
    const weeklyRows = await supaService(
      `weekly_health_snapshots?select=lab_name,week_start,health_color,days_since_activity&week_start=gte.${monthStart}&week_start=lt.${monthEnd}&lab_name=in.(${labNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(",")})`,
    ) as Array<{ lab_name: string; health_color: string; days_since_activity: number | null }>;
    const colorsByLab = new Map<string, { g: number; y: number; o: number; r: number; days: number[] }>();
    for (const w of weeklyRows) {
      const e = colorsByLab.get(w.lab_name) ?? { g: 0, y: 0, o: 0, r: 0, days: [] };
      if (w.health_color === "green") e.g++; else if (w.health_color === "yellow") e.y++; else if (w.health_color === "orange") e.o++; else if (w.health_color === "red") e.r++;
      if (typeof w.days_since_activity === "number") e.days.push(w.days_since_activity);
      colorsByLab.set(w.lab_name, e);
    }

    // 5. Assemble one row per lab.
    const rows = labs.map((lab) => {
      const org = orgByCompany.get(lab.hubspot_company_id!);
      const comms = org ? (commsByOrg.get(org) ?? []) : [];
      // distinct login weeks across the lab's directors + coaches
      const loginW = new Set<string>();
      for (const id of (org ? (dirsByOrg.get(org) ?? []) : [])) for (const w of loginWeeksByUser.get(`director:${id}`) ?? []) loginW.add(w);
      for (const c of comms) for (const id of (coachesByComm.get(c) ?? [])) for (const w of loginWeeksByUser.get(`coach:${id}`) ?? []) loginW.add(w);
      const athW = new Set<string>(); for (const c of comms) for (const w of athWeeksByComm.get(c) ?? []) athW.add(w);
      const assW = new Set<string>(); for (const c of comms) for (const w of assWeeksByComm.get(c) ?? []) assW.add(w);

      const login_sub_score = subScore(loginW.size);
      const athletes_sub_score = subScore(athW.size);
      const assessments_sub_score = subScore(assW.size);
      const cs = colorsByLab.get(lab.lab_name) ?? { g: 0, y: 0, o: 0, r: 0, days: [] };
      const counts: Array<[string, number]> = [["green", cs.g], ["yellow", cs.y], ["orange", cs.o], ["red", cs.r]];
      const dominant_color = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[1] > 0 ? counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
      const avg_days_inactive = cs.days.length ? Math.round(cs.days.reduce((n, d) => n + d, 0) / cs.days.length) : null;

      return {
        director_id: lab.director_id,
        lab_name: lab.lab_name,
        month: monthStart,
        health_score: login_sub_score + athletes_sub_score + assessments_sub_score,
        login_sub_score, athletes_sub_score, assessments_sub_score,
        green_weeks: cs.g, yellow_weeks: cs.y, orange_weeks: cs.o, red_weeks: cs.r,
        avg_days_inactive, dominant_color,
      };
    });

    await upsert("monthly_health_snapshots", rows, "lab_name,month");
    await recordRun(JOB, "success", rows.length, startedAt);
    return new Response(JSON.stringify({ job: JOB, month: monthStart, labs: rows.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await recordRun(JOB, "error", 0, startedAt, e instanceof Error ? e.message : String(e));
    await alertSlack(JOB, e);
    return new Response(JSON.stringify({ job: JOB, error: String(e) }), { status: 500 });
  }
});

function pushSet(m: Map<string, Set<string>>, k: string, v: string) {
  const s = m.get(k); if (s) s.add(v); else m.set(k, new Set([v]));
}
