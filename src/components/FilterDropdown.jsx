import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

// Shared multi-select filter dropdown — used by My Customers and Onboarding.
// Filters AND across categories, OR within a category. Styles: .mc-filter* in
// index.css.

// Hardware is a multi-value list ("Timing Gates; Dashr"); split into tokens.
export const splitHw = (s) =>
  s ? String(s).split(/[;,\n]+/).map(t => t.trim()).filter(Boolean) : []

export default function FilterDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  return (
    <div className="mc-filter" ref={ref}>
      <button className={`mc-filter-btn ${selected.length ? 'active' : ''}`} onClick={() => setOpen(o => !o)}>
        {label}{selected.length > 0 && <span className="mc-filter-count">{selected.length}</span>}
        <ChevronDown size={14} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="mc-filter-pop scrollbar-thin">
          <div className="mc-filter-pop-head">
            <span>{label}</span>
            {selected.length > 0 && <button className="mc-filter-clear" onClick={() => onChange([])}>Clear</button>}
          </div>
          {options.length === 0 && <div className="mc-filter-empty">No values</div>}
          {options.map(o => (
            <label key={o.value} className="mc-filter-opt">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="mc-filter-opt-l">{o.label}</span>
              {o.count != null && <span className="mc-filter-optn">{o.count}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
