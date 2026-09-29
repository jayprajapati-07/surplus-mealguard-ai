import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { FLOW_ROLES, IMPORT_ROLES, MENU_ROLES, REDIST_ROLES, AUDIT_ROLES } from './guards';
import { api } from '../api';
import { useEffect, useState, type ReactNode } from 'react';

function linkClass(active: boolean) {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    active ? 'bg-leaf-700 text-white' : 'text-stone-700 hover:bg-leaf-100 hover:text-leaf-900'
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

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
    if (!showNotif) { setUnread(0); return; }
    api<{ unreadCount: number }>('/notifications/unread-count')
      .then((d) => setUnread(d.unreadCount))
      .catch(() => setUnread(0));
  }, [showNotif, user?.id, location.pathname]);

  async function handleLogout() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-700 text-lg text-white" aria-hidden="true">
              ♻
            </div>
            <div>
              <p className="text-base font-bold text-leaf-900">Surplus MealGuard AI</p>
              <p className="text-xs text-stone-500">Smart Food Waste Prevention &amp; Redistribution (SIH Prototype)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showNotif && (
              <button
                onClick={() => navigate('/notifications')}
                className="relative rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              >
                🔔
                {unread > 0 && (
                  <span data-testid="notif-badge" className="absolute -right-2 -top-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}
            {user && (
              <span className="hidden rounded-full bg-leaf-100 px-3 py-1 text-xs font-medium text-leaf-900 sm:inline">
                {user.name} · {user.role}
              </span>
            )}
            <button
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      {!online && (
        <div role="alert" className="bg-amber-600 px-4 py-2 text-center text-xs font-semibold text-white">
          ⚠ You appear to be offline. Network requests may fail until connection is restored.
        </div>
      )}

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        {user && (
          <nav aria-label="Primary" className={`${menuOpen ? 'block' : 'hidden'} w-56 shrink-0 sm:block`}>
            <div className="space-y-1 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
              <NavLink to="/demo-guide" className={({ isActive }) => linkClass(isActive)}>
                Demo Guide
              </NavLink>

              {user.role !== 'NGO' && (
                <NavLink to="/" className={({ isActive }) => linkClass(isActive)} end>
                  Dashboard
                </NavLink>
              )}
              {user.role && REDIST_ROLES.includes(user.role) && (
                <NavLink to="/redistribution" className={({ isActive }) => linkClass(isActive)}>
                  Redistribution
                </NavLink>
              )}
              {user.role === 'SUPER_ADMIN' && (
                <NavLink to="/ngos" className={({ isActive }) => linkClass(isActive)}>
                  NGO Registry
                </NavLink>
              )}
              {user.role && MENU_ROLES.includes(user.role) && (
                <NavLink to="/menu" className={({ isActive }) => linkClass(isActive)}>
                  Menu
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/memory" className={({ isActive }) => linkClass(isActive)}>
                  Digital Memory
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/analytics" className={({ isActive }) => linkClass(isActive)}>
                  Analytics
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/reports" className={({ isActive }) => linkClass(isActive)}>
                  Reports
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/food-data" className={({ isActive }) => linkClass(isActive)}>
                  Food Data
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/flow" className={({ isActive }) => linkClass(isActive)}>
                  Food Flow
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/notifications" className={({ isActive }) => linkClass(isActive)}>
                  Notifications
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/inventory" className={({ isActive }) => linkClass(isActive)}>
                  Inventory
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/eod" className={({ isActive }) => linkClass(isActive)}>
                  End of Day
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/waste" className={({ isActive }) => linkClass(isActive)}>
                  Waste Analysis
                </NavLink>
              )}
              {user.role && FLOW_ROLES.includes(user.role) && (
                <NavLink to="/eligibility" className={({ isActive }) => linkClass(isActive)}>
                  Eligibility
                </NavLink>
              )}
              {user.role && IMPORT_ROLES.includes(user.role) && (
                <NavLink to="/imports" className={({ isActive }) => linkClass(isActive)}>
                  Imports
                </NavLink>
              )}
              {user.role && AUDIT_ROLES.includes(user.role) && (
                <NavLink to="/audit" className={({ isActive }) => linkClass(isActive)}>
                  Audit Log
                </NavLink>
              )}
              {user.role !== 'NGO' && (
                <NavLink to="/organization" className={({ isActive }) => linkClass(isActive)}>
                  Organization
                </NavLink>
              )}
              <button
                onClick={handleLogout}
                disabled={signingOut}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                aria-label="Log out"
              >
                {signingOut ? 'Signing out…' : 'Logout'}
              </button>
            </div>
          </nav>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
