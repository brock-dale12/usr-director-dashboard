// Health color system — matches director_report.py + Doc scoring
export const HEALTH = {
  green: {
    label: 'Active',
    emoji: '🟢',
    dot: 'bg-green-500',
    badge: 'bg-green-50 text-green-700 border border-green-200',
    ring: 'ring-green-400',
    border: 'border-l-green-500',
    text: 'text-green-600',
    bar: 'bg-green-500',
  },
  yellow: {
    label: 'Quiet',
    emoji: '🟡',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    ring: 'ring-yellow-400',
    border: 'border-l-yellow-400',
    text: 'text-yellow-600',
    bar: 'bg-yellow-400',
  },
  orange: {
    label: 'Inactive',
    emoji: '🟠',
    dot: 'bg-orange-400',
    badge: 'bg-orange-50 text-orange-700 border border-orange-200',
    ring: 'ring-orange-400',
    border: 'border-l-orange-400',
    text: 'text-orange-600',
    bar: 'bg-orange-500',
  },
  red: {
    label: 'Critical',
    emoji: '🔴',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border border-red-200',
    ring: 'ring-red-400',
    border: 'border-l-red-500',
    text: 'text-red-600',
    bar: 'bg-red-500',
  },
  unknown: {
    label: 'No data',
    emoji: '⚪',
    dot: 'bg-gray-300',
    badge: 'bg-gray-100 text-gray-500 border border-gray-200',
    ring: 'ring-gray-300',
    border: 'border-l-gray-300',
    text: 'text-gray-400',
    bar: 'bg-gray-300',
  },
}

export const TRIGGER_LABELS = {
  red:             'Critical Outreach',
  orange:          'Check-In',
  two_week_yellow: 'Consistency Check',
  onboarding:      'New Member',
  renewal_90:      'Renewal Prep',
  monthly_green:   'Monthly Win',
  monthly_yellow:  'Monthly Push',
}

export const TRIGGER_COLORS = {
  red:             'bg-red-50 text-red-700 border border-red-200',
  orange:          'bg-orange-50 text-orange-700 border border-orange-200',
  two_week_yellow: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  onboarding:      'bg-blue-50 text-blue-700 border border-blue-200',
  renewal_90:      'bg-purple-50 text-purple-700 border border-purple-200',
  monthly_green:   'bg-green-50 text-green-700 border border-green-200',
  monthly_yellow:  'bg-yellow-50 text-yellow-700 border border-yellow-200',
}

// Sort order for outreach triggers (most urgent first)
export const TRIGGER_ORDER = [
  'red', 'orange', 'two_week_yellow', 'onboarding', 'renewal_90', 'monthly_green', 'monthly_yellow',
]

export function getHealth(color) {
  return HEALTH[color] || HEALTH.unknown
}
