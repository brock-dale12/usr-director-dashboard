import { supabase } from './supabase'

/**
 * Fetch ALL rows from a table, paging past Supabase/PostgREST's default
 * 1,000-row response cap. Without this, large tables (e.g. weekly_health_snapshots,
 * ~2k+ rows) get silently truncated and customers appear to have "no data".
 *
 *   await fetchAllRows('weekly_health_snapshots')
 *   await fetchAllRows('monthly_health_snapshots', 'lab_name, deal_id, month, health_score')
 */
export async function fetchAllRows(table, columns = '*') {
  const PAGE = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    all = all.concat(rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}
