// onboardingBoard — pure helpers for the pipeline board. Logic lives here (and is
// unit-tested); the page is just data-loading + rendering on top.

import { OB_STAGES, gatingKeys } from './onboardingCatalog.js'

// Current journey stage = first stage whose GATING tasks aren't all done.
// Mirrors deriveStage in Onboarding.jsx — the canonical CSM-driven rule.
export function deriveJourneyStage(doneSet) {
  for (const s of OB_STAGES) {
    const gates = gatingKeys(s.key)
    const complete = gates.length === 0 || gates.every(k => doneSet.has(k))
    if (!complete) return { stageKey: s.key, graduated: false }
  }
  return { stageKey: 'qbr', graduated: true }
}

// Newest row per key (e.g. latest weekly snapshot per lab_name). dateField is a
// sortable string (ISO date / timestamp). Ties keep the first seen.
export function latestByKey(rows, keyField, dateField) {
  const m = new Map()
  for (const r of rows || []) {
    const k = r?.[keyField]
    if (k == null) continue
    const cur = m.get(k)
    if (!cur || String(r[dateField] ?? '') > String(cur[dateField] ?? '')) m.set(k, r)
  }
  return m
}

// Group enriched customer cards into ordered board columns + a Graduated column.
// Each card must carry { stageKey, graduated }.
export function groupByStage(customers) {
  const cols = OB_STAGES.map(s => ({ key: s.key, label: s.label, short: s.short, cards: [] }))
  const idx = Object.fromEntries(cols.map((c, i) => [c.key, i]))
  const graduated = { key: 'graduated', label: 'Graduated', short: 'Graduated', cards: [] }
  for (const c of customers || []) {
    if (c.graduated) { graduated.cards.push(c); continue }
    const col = cols[idx[c.stageKey]] ?? cols[0]
    col.cards.push(c)
  }
  return [...cols, graduated]
}

// Days a card has sat (from kickoff_date if set, else contract_start_date), for the
// "days in onboarding" chip. Returns null when no anchor.
export function daysSince(anchorIso, now = Date.now()) {
  if (!anchorIso) return null
  const t = Date.parse(`${String(anchorIso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  const d = Math.floor((now - t) / 86_400_000)
  return d >= 0 ? d : null
}

// TTV display state for a card from an onboarding_ttv row (or null).
export const TTV_PILL = {
  passed: { label: 'TTV ✓', color: '#1DB271' },
  in_progress: { label: 'TTV…', color: '#FFD900' },
  review: { label: 'TTV ?', color: '#F2810E' },
  failed: { label: 'TTV ✗', color: '#EC3642' },
  not_started: { label: 'TTV —', color: '#C9CBCE' },
}
export function ttvPill(ttvRow) {
  const status = ttvRow?.status || 'not_started'
  const meta = TTV_PILL[status] || TTV_PILL.not_started
  const n = ttvRow?.recaps_in_window
  return { ...meta, recaps: typeof n === 'number' ? n : null }
}
