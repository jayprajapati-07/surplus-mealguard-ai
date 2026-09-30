import { NavLink, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { FLOW_ROLES, MENU_ROLES, REDIST_ROLES, AUDIT_ROLES } from './guards';
import { api } from '../api';
import { useEffect, useRef, useState, type ReactNode } from 'react';

function linkClass(active: boolean) {
  return `flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
    active
      ? 'bg-[#1565C0] text-white shadow-sm font-semibold'
      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const profileRef = useRef<HTMLDivElement>(null);

  const showNotif = !!user && FLOW_ROLES.includes(user.role);

  useEffect(() => {
    function handleOnline() { setOnline(true); }
    function handleOffline() { setOnline(false); }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showNotif) { setUnread(0); return; }
    api<{ unreadCount: number }>('/notifications/unread-count')
      .then((d) => setUnread(d.unreadCount))
      .catch(() => setUnread(0));
  }, [showNotif, user?.id, location.pathname]);

  async function handleLogout() {
    setSigningOut(true);
    setProfileOpen(false);
    await signOut();
    setSigningOut(false);
    navigate('/login', { replace: true });
  }

  // Determine current page title for the header
  const getHeaderTitle = () => {
    const p = location.pathname;
    if (p === '/' || p === '/dashboard') return 'Main Dashboard';
    if (p.includes('food-distribution') || p.includes('redistribution')) return 'Food Distribution';
    if (p.includes('end-of-day-report') || p.includes('eod')) return 'End of Day Report';
    if (p.includes('waste-analysis') || p.includes('waste')) return 'Waste Analysis';
    if (p.includes('reports')) return 'Reports';
    if (p.includes('menu-management') || p.includes('menu')) return 'Menu Management';
    if (p.includes('settings') || p.includes('organization')) return 'Settings';
    return 'Main Dashboard';
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Top Header - Dark Navy #0B1F33 */}
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-[#0B1F33] text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-slate-700 p-1.5 text-stone-200 hover:bg-navy-800 sm:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1565C0] text-lg font-bold text-white shadow-sm" aria-hidden="true">
                🌿
              </span>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
                  {getHeaderTitle()}
                </h1>
                <p className="hidden text-xs text-stone-400 sm:block">
                  Surplus MealGuard AI · Enterprise Food Flow System
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notification Icon */}
            {showNotif && (
              <button
                onClick={() => navigate('/notifications')}
                className="relative rounded-xl border border-slate-700 bg-navy-800 p-2 text-stone-200 transition-colors hover:bg-navy-700 hover:text-white"
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              >
                <span className="text-base">🔔</span>
                {unread > 0 && (
                  <span data-testid="notif-badge" className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white shadow">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}

            {/* Profile Dropdown Menu */}
            {user && (
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-navy-800 px-3 py-1.5 text-stone-200 transition-colors hover:bg-navy-700 hover:text-white"
                  aria-expanded={profileOpen}
                  aria-haspopup="true"
                  aria-label="User account menu"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1565C0] text-xs font-semibold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden text-xs font-medium sm:inline">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-stone-400">▼</span>
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-stone-200 bg-white py-2 text-stone-800 shadow-xl z-50">
                    <div className="border-b border-stone-100 px-4 py-2.5">
                      <p className="text-xs font-semibold text-stone-900 truncate">{user.name}</p>
                      <p className="text-[11px] text-stone-500 truncate">{user.email}</p>
                      <span className="mt-1 inline-block rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700">
                        {user.role}
                      </span>
                    </div>

                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      Profile &amp; Account
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      Organization
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      Settings
                    </Link>

                    <div className="my-1 border-t border-stone-100"></div>

                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={signingOut}
                      className="block w-full px-4 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {signingOut ? 'Signing out…' : 'Logout'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {!online && (
        <div role="alert" className="bg-amber-600 px-4 py-2 text-center text-xs font-semibold text-white">
          ⚠ You appear to be offline. Network requests may fail until connection is restored.
        </div>
      )}

      {/* Main Content Area with Left Sidebar */}
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6">
        {user && (
          <aside
            aria-label="Sidebar Navigation"
            className={`${menuOpen ? 'fixed inset-y-0 left-0 z-40 w-64 bg-white p-4 shadow-2xl' : 'hidden'} shrink-0 sm:block sm:w-60`}
          >
            {menuOpen && (
              <div className="mb-4 flex items-center justify-between sm:hidden">
                <span className="font-bold text-navy-900">Navigation</span>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-xs"
                >
                  ✕ Close
                </button>
              </div>
            )}

            <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm">
              <div className="px-2 pt-1 pb-2 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🌿</span>
                  <p className="font-bold text-sm tracking-tight text-navy-900">Surplus MealGuard AI</p>
                </div>
              </div>

              {/* Primary Specified Navigation */}
              <nav className="space-y-1">
                {user.role !== 'NGO' && (
                  <NavLink
                    to="/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/')}
                  >
                    <span>📊</span>
                    <span>Dashboard</span>
                  </NavLink>
                )}

                {user.role && REDIST_ROLES.includes(user.role) && (
                  <NavLink
                    to="/food-distribution"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/redistribution')}
                  >
                    <span>🤝</span>
                    <span>Food Distribution</span>
                  </NavLink>
                )}

                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/end-of-day-report"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/eod')}
                  >
                    <span>📋</span>
                    <span>End of Day Report</span>
                  </NavLink>
                )}

                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/waste-analysis"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/waste')}
                  >
                    <span>📉</span>
                    <span>Waste Analysis</span>
                  </NavLink>
                )}

                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/reports"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    <span>📑</span>
                    <span>Reports</span>
                  </NavLink>
                )}

                {user.role && MENU_ROLES.includes(user.role) && (
                  <NavLink
                    to="/menu-management"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/menu')}
                  >
                    <span>🍽️</span>
                    <span>Menu Management</span>
                  </NavLink>
                )}

                {user.role !== 'NGO' && (
                  <NavLink
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => linkClass(isActive || location.pathname === '/organization')}
                  >
                    <span>⚙️</span>
                    <span>Settings</span>
                  </NavLink>
                )}
              </nav>

              {/* Sidebar Logout button */}
              <div className="border-t border-stone-100 pt-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 transition-colors"
                  aria-label="Log out"
                >
                  <span>🚪</span>
                  <span>{signingOut ? 'Signing out…' : 'Logout'}</span>
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Viewport */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
