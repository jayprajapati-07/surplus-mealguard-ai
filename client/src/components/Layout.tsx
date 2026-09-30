import { NavLink, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { FLOW_ROLES, MENU_ROLES, REDIST_ROLES } from './guards';
import { api } from '../api';
import { useEffect, useRef, useState, type ReactNode } from 'react';

declare global {
  interface Window {
    showToast?: (message: string) => void;
  }
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
  const [toastMsg, setToastMsg] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotif = !!user && FLOW_ROLES.includes(user.role);

  // Global toast function hook
  useEffect(() => {
    window.showToast = (msg: string) => {
      setToastMsg(msg);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setToastMsg('');
      }, 2800);
    };
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

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
    if (window.showToast) window.showToast('Logout session terminated safely');
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
    if (p.includes('notifications')) return 'Notifications';
    return 'Main Dashboard';
  };

  const navLinkClass = (isActive: boolean) =>
    isActive
      ? 'flex items-center space-x-3 px-3.5 py-2.5 bg-[#006B48] text-white rounded-xl shadow-sm font-semibold text-[14.5px] border border-white/10 transition-all duration-200 hover:shadow'
      : 'group flex items-center space-x-3 px-3.5 py-2.5 text-[#98D8BA] hover:bg-[#003B29] hover:text-white rounded-xl transition-all duration-200 font-medium text-[14.5px]';

  return (
    <div className="min-h-screen flex flex-col bg-[#EEF5F1] text-[#0C2741] overflow-x-hidden font-sans">
      {/* Toast Feedback Container */}
      <div
        id="toastNotification"
        role="status"
        aria-live="polite"
        className={`fixed bottom-6 right-6 z-50 flex items-center space-x-3 bg-[#0C2741] text-white px-4 py-3 rounded-xl shadow-2xl border border-white/10 transition-all duration-300 ease-out ${
          toastMsg ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none translate-y-3'
        }`}
      >
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-xs sm:text-sm font-semibold tracking-wide" id="toastMessage">
          {toastMsg || 'Action executed successfully'}
        </p>
      </div>

      {/* BEGIN: TopBar */}
      <header className="animate-header w-full bg-[#004C35] text-white h-[74px] px-4 md:px-6 flex items-center justify-between shadow-sm flex-shrink-0 z-30 transition-all duration-300 sticky top-0 border-b border-[#003B29]">
        {/* Left: Hamburger (Mobile/Tablet only) + Brand Logo & Title */}
        <div className="flex items-center space-x-3 md:space-x-3.5">
          {user && (
            <button
              aria-label="Open sidebar menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-xl text-white/90 hover:text-white hover:bg-[#003B29] transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#98D8BA]"
              id="openSidebarBtn"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          <div className="w-10 h-10 rounded-xl bg-[#005c41] flex items-center justify-center p-1.5 shadow-inner flex-shrink-0 transition-transform duration-300 hover:rotate-6">
            <svg className="w-7 h-7 text-[#22C55E]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.5 2 2 6.5 2 12c0 2.2.8 4.2 2.1 5.8L4 21c1.5 0 3.2-.6 4.3-1.7C9.8 19.8 10.9 20 12 20c5.5 0 10-4.5 10-10 0-5.5-4.5-8-10-8zm-1 15c-2.8 0-5-2.2-5-5 0-2.2 1.4-4.1 3.5-4.7v5.2l3 2.1c-.5.4-1 .4-1.5.4z" />
              <path d="M12 3c4.97 0 9 4.03 9 9 0 2.12-.74 4.07-1.97 5.61l-7.03-7.03V3.5c0-.28.22-.5.5-.5z" fill="#4ADE80" opacity="0.9" />
            </svg>
          </div>

          <div>
            <h1 className="text-[17px] md:text-[19px] font-bold tracking-tight text-white leading-tight">
              {getHeaderTitle()}
            </h1>
            <p className="text-[11px] md:text-xs text-[#98D8BA] font-medium tracking-wide">
              Surplus MealGuard AI · Enterprise Food Flow System
            </p>
          </div>
        </div>

        {/* Right: Notifications & User Profile */}
        <div className="flex items-center space-x-3 md:space-x-4">
          {/* Notification Icon Button */}
          {user && (
            <button
              onClick={() => {
                if (showNotif) {
                  navigate('/notifications');
                } else {
                  if (window.showToast) window.showToast('Notifications checked: all food routes normal.');
                }
              }}
              className="relative w-10 h-10 rounded-full bg-[#003B29]/60 hover:bg-[#003B29] transition-all duration-200 hover:scale-105 active:scale-95 border border-[#005e42] flex items-center justify-center text-white/90"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <svg className="w-5 h-5 text-gray-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="notification-ping absolute top-2 right-2 w-2 h-2 rounded-full bg-[#F59E0B] ring-2 ring-[#004C35]"></span>
              {unread > 0 && (
                <span data-testid="notif-badge" className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          )}

          {/* User Dropdown Pill */}
          {user && (
            <div className="relative" ref={profileRef}>
              <div
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center bg-[#003B29]/60 hover:bg-[#003B29] transition-all duration-200 hover:scale-[1.02] active:scale-95 py-1 pl-1 pr-3 rounded-full border border-[#005e42] cursor-pointer"
                aria-expanded={profileOpen}
                aria-label="User account menu"
              >
                <div className="w-8 h-8 rounded-full bg-[#0284C7] flex items-center justify-center font-bold text-white text-sm shadow-sm">
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="ml-2 text-sm font-semibold text-white hidden sm:inline">{user.name}</span>
                <svg className={`w-4 h-4 ml-1.5 text-gray-300 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-stone-200 bg-white py-2 text-stone-800 shadow-2xl z-50 animate-fadeInUpStagger">
                  <div className="border-b border-stone-100 px-4 py-2.5">
                    <p className="text-xs font-semibold text-[#0C2741] truncate">{user.name}</p>
                    <p className="text-[11px] text-stone-500 truncate">{user.email}</p>
                    <span className="mt-1.5 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-[#006B48]">
                      {user.role}
                    </span>
                  </div>

                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-[#F2F7F4] hover:text-[#0C2741] transition-colors"
                  >
                    Profile &amp; Account
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-[#F2F7F4] hover:text-[#0C2741] transition-colors"
                  >
                    Organization
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block px-4 py-2 text-xs font-medium text-stone-700 hover:bg-[#F2F7F4] hover:text-[#0C2741] transition-colors"
                  >
                    Settings
                  </Link>

                  <div className="my-1 border-t border-stone-100"></div>

                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={signingOut}
                    className="block w-full px-4 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {signingOut ? 'Signing out…' : 'Logout'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      {/* END: TopBar */}

      {!online && (
        <div role="alert" className="bg-amber-600 px-4 py-2 text-center text-xs font-semibold text-white">
          ⚠ You appear to be offline. Network requests may fail until connection is restored.
        </div>
      )}

      {/* Backdrop Overlay for Mobile/Tablet Drawer */}
      <div
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
        className={`fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 transition-opacity duration-300 ease-in-out lg:hidden ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        id="sidebarBackdrop"
      />

      {/* Main Container */}
      <div className="flex flex-1 w-full relative min-h-0">
        {/* BEGIN: LeftSidebar */}
        {user && (
          <aside
            aria-label="Sidebar Navigation"
            id="mainSidebar"
            className={`animate-sidebar fixed inset-y-0 left-0 z-50 lg:z-20 w-[260px] lg:w-[270px] max-w-[85vw] h-full lg:h-[calc(100vh-74px)] lg:sticky lg:top-[74px] bg-[#004C35] text-white border-r border-[#003B29] shadow-2xl lg:shadow-none flex flex-col justify-between py-5 px-3.5 custom-scrollbar-dark overflow-y-auto transform transition-transform duration-300 ease-in-out flex-shrink-0 ${
              menuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            }`}
          >
            <div className="space-y-6">
              {/* Logo Header in Sidebar & Close Button for mobile drawer */}
              <div className="flex items-center justify-between px-3 py-1">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#005c41] flex items-center justify-center transition-transform duration-300 hover:rotate-6">
                    <svg className="w-5 h-5 text-[#22C55E]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25V7.5c4 0 7.5.5 8 1.5z" />
                    </svg>
                  </div>
                  <span className="font-bold text-[16px] tracking-tight text-white">
                    Surplus MealGuard AI
                  </span>
                </div>
                {/* Mobile Close Button (X) */}
                <button
                  aria-label="Close sidebar menu"
                  onClick={() => setMenuOpen(false)}
                  className="lg:hidden p-1.5 text-white/80 hover:text-white hover:bg-[#003B29] rounded-lg transition-colors active:scale-95"
                  id="closeSidebarBtn"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Main Navigation Links */}
              <nav className="space-y-1 text-sm font-medium">
                {/* Dashboard */}
                {user.role !== 'NGO' && (
                  <NavLink
                    to="/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Dashboard</span>
                  </NavLink>
                )}

                {/* Food Distribution */}
                {user.role && REDIST_ROLES.includes(user.role) && (
                  <NavLink
                    to="/food-distribution"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/redistribution')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-[#FBBF24] transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Food Distribution</span>
                  </NavLink>
                )}

                {/* End of Day Report */}
                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/end-of-day-report"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/eod')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-[#98D8BA] group-hover:text-white transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>End of Day Report</span>
                  </NavLink>
                )}

                {/* Waste Analysis */}
                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/waste-analysis"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/waste')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-[#60A5FA] transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Waste Analysis</span>
                  </NavLink>
                )}

                {/* Reports */}
                {user.role && FLOW_ROLES.includes(user.role) && (
                  <NavLink
                    to="/reports"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive)}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-[#98D8BA] group-hover:text-white transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Reports</span>
                  </NavLink>
                )}

                {/* Menu Management */}
                {user.role && MENU_ROLES.includes(user.role) && (
                  <NavLink
                    to="/menu-management"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/menu')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-[#FCD34D] transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Menu Management</span>
                  </NavLink>
                )}

                {/* Settings */}
                {user.role !== 'NGO' && (
                  <NavLink
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => navLinkClass(isActive || location.pathname === '/organization')}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-gray-300 group-hover:text-white transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Settings</span>
                  </NavLink>
                )}
              </nav>
            </div>

            {/* Bottom Logout Button */}
            <div className="pt-4 border-t border-[#005e42]">
              <button
                type="button"
                onClick={handleLogout}
                disabled={signingOut}
                className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-red-300 hover:text-red-200 hover:bg-[#003B29] rounded-xl font-medium text-sm transition-all duration-200 active:scale-95 disabled:opacity-50"
                aria-label="Log out"
              >
                <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-medium text-[15px]">{signingOut ? 'Signing out…' : 'Logout'}</span>
              </button>
            </div>
          </aside>
        )}
        {/* END: LeftSidebar */}

        {/* Main Content Viewport */}
        <main className="flex-1 flex flex-col space-y-6 p-4 sm:p-6 lg:p-8 min-w-0 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
