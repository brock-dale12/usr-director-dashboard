import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { MapPin, Mail, Trophy, Shield, LogOut, Users, Rocket, RefreshCw, CreditCard, Link2, Settings as SettingsIcon } from 'lucide-react'
import SpeedLabLogo from './SpeedLabLogo'
import USRLogo from './USRLogo'
import SyncStatusBadge from './SyncStatusBadge'

// Speed Lab Director nav — unchanged.
const DIRECTOR_NAV = [
  { to: '/',            icon: MapPin,  label: 'My Region',    exact: true  },
  { to: '/outreach',    icon: Mail,    label: 'Outreach Hub', exact: false },
  { to: '/leaderboard', icon: Trophy,  label: 'Leaderboard',  exact: false },
  { to: '/settings',    icon: SettingsIcon, label: 'Settings', exact: false },
]

// USR internal staff (Admin) nav — Customer Success Hub.
const ADMIN_NAV = [
  { to: '/',            icon: Users,      label: 'My Customers', exact: true  },
  { to: '/outreach',    icon: Mail,       label: 'Outreach Hub', exact: false },
  { to: '/onboarding',  icon: Rocket,     label: 'Onboarding',   exact: false },
  { to: '/renewals',    icon: RefreshCw,  label: 'Renewals',     exact: false },
  { to: '/payments',    icon: CreditCard, label: 'Payments',     exact: false },
  { to: '/admin',       icon: Shield,     label: 'Director View', exact: false },
  { to: '/connections', icon: Link2,      label: 'Data Connections', exact: false },
  { to: '/leaderboard', icon: Trophy,     label: 'Leaderboard',  exact: false },
  { to: '/settings',    icon: SettingsIcon, label: 'Settings',    exact: false },
]

function NavItem({ to, icon: Icon, label, badge, exact }) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
    >
      <span className="sidebar-icon"><Icon size={18} /></span>
      <span>{label}</span>
      {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  )
}

export default function Layout({ children }) {
  const { director, signOut } = useAuth()
  const navigate = useNavigate()

  const isAdmin  = !!director?.is_admin
  const navItems = isAdmin ? ADMIN_NAV : DIRECTOR_NAV

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = director?.name
    ? director.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'D'

  const roleLabel = isAdmin
    ? 'Customer Success'
    : (director?.org_name || 'Speed Lab')

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          {isAdmin ? <USRLogo height={30} /> : <SpeedLabLogo height={34} />}
          <span className="mark-sub">{isAdmin ? 'Customer Success Hub' : 'Director Hub'}</span>
        </div>

        {/* Nav section label */}
        <div className="sidebar-section-label">Navigation</div>

        {/* Nav items */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        {/* Data sync freshness — admin only */}
        {isAdmin && <SyncStatusBadge />}

        {/* Footer: user + sign out */}
        <div className="sidebar-footer">
          <div className="dir-row">
            <div className="dir-avatar">{initials}</div>
            <div>
              <div className="dir-name">{director?.name || 'Director'}</div>
              <div className="dir-role">{roleLabel}</div>
            </div>
          </div>
          <button className="dir-signout" onClick={handleSignOut}>
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main scrollbar-thin" style={{ overflowY: 'auto', height: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
