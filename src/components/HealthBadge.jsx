import { getHealth } from '../lib/colors'

export default function HealthBadge({ color, size = 'sm', showLabel = true }) {
  const h = getHealth(color)

  if (size === 'dot') {
    return (
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${h.dot} flex-shrink-0`} />
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${h.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${h.dot} flex-shrink-0`} />
      {showLabel && h.label}
    </span>
  )
}
