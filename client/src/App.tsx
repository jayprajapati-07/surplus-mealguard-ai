import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  RequireAuth,
  RequireOnboarded,
  RequireNoOrg,
  PublicOnly,
  RequireMenuAccess,
  RequireImportAccess,
  RequireFoodDataAccess,
  RequireRedistributionAccess,
  RequireSuperAdmin,
} from './components/guards';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Forgot, Reset } from './pages/AuthExtras';
import { SetupPage } from './pages/SetupPage';
import { Dashboard } from './pages/Dashboard';
import { OrganizationPage } from './pages/Organization';
import { MenuPage } from './pages/MenuPage';
import { FoodData } from './pages/FoodData';
import { Imports } from './pages/Imports';
import { Notifications } from './pages/Notifications';
import { Inventory } from './pages/Inventory';
import { EndOfDay } from './pages/EndOfDay';
import { Waste } from './pages/Waste';
import { Eligibility } from './pages/Eligibility';
import { Redistribution } from './pages/Redistribution';
import { NgoRegistry } from './pages/NgoRegistry';
import { Analytics } from './pages/Analytics';
import { Reports } from './pages/Reports';

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0B1F33] text-lg text-white" aria-hidden="true">🌱</div>
          <div>
            <p className="text-base font-bold text-[#0B1F33]">Surplus MealGuard AI</p>
            <p className="text-xs text-slate-500">Smart Food Waste Prevention &amp; Redistribution</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-600 text-xl font-bold">
        404
      </div>
      <h1 className="text-xl font-bold text-stone-900">Page not found</h1>
      <p className="mt-2 text-sm text-stone-600">The requested page or resource could not be found.</p>
      <div className="mt-5 flex justify-center gap-3">
        <Link to="/dashboard" className="rounded-lg bg-[#0B1F33] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0]">
          Go to Dashboard
        </Link>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* PUBLIC / AUTH PAGES */}
            <Route path="/login" element={<PublicShell><PublicOnly><Login /></PublicOnly></PublicShell>} />
            <Route path="/signup" element={<PublicShell><PublicOnly><Signup /></PublicOnly></PublicShell>} />
            <Route path="/forgot" element={<PublicShell><Forgot /></PublicShell>} />
            <Route path="/forgot-password" element={<PublicShell><Forgot /></PublicShell>} />
            <Route path="/reset" element={<PublicShell><Reset /></PublicShell>} />
            <Route path="/reset-password" element={<PublicShell><Reset /></PublicShell>} />
            <Route path="/verify" element={<Navigate to="/login" replace />} />

            {/* ONBOARDING PAGE - COMPLETELY SEPARATE (NO LAYOUT, NO SIDEBAR, NO SHELL) */}
            <Route
              path="/setup"
              element={
                <RequireAuth>
                  <RequireNoOrg>
                    <SetupPage />
                  </RequireNoOrg>
                </RequireAuth>
              }
            />
            {/* Redirect legacy /onboarding to /setup */}
            <Route path="/onboarding" element={<Navigate to="/setup" replace />} />

            {/* APPLICATION PAGES */}
            <Route
              path="/dashboard"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireOnboarded>
                      <Dashboard />
                    </RequireOnboarded>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireOnboarded>
                      <Dashboard />
                    </RequireOnboarded>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/food-distribution"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireRedistributionAccess>
                      <Redistribution />
                    </RequireRedistributionAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/redistribution"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireRedistributionAccess>
                      <Redistribution />
                    </RequireRedistributionAccess>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/end-of-day-report"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <EndOfDay />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/eod"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <EndOfDay />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/waste-analysis"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Waste />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/waste"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Waste />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/reports"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Reports />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/menu-management"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireMenuAccess>
                      <MenuPage />
                    </RequireMenuAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/menu"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireMenuAccess>
                      <MenuPage />
                    </RequireMenuAccess>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route
              path="/settings"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireOnboarded>
                      <OrganizationPage />
                    </RequireOnboarded>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/organization"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireOnboarded>
                      <OrganizationPage />
                    </RequireOnboarded>
                  </RequireAuth>
                </Layout>
              }
            />

            {/* REMOVED KITCHEN INTELLIGENCE ROUTES -> REDIRECT TO DASHBOARD */}
            <Route path="/demo-guide" element={<Navigate to="/dashboard" replace />} />
            <Route path="/memory" element={<Navigate to="/dashboard" replace />} />
            <Route path="/flow" element={<Navigate to="/dashboard" replace />} />
            <Route path="/audit" element={<Navigate to="/dashboard" replace />} />

            {/* ADDITIONAL INSTITUTION WORKSPACE PAGES */}
            <Route
              path="/food-data"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <FoodData />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/imports"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireImportAccess>
                      <Imports />
                    </RequireImportAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/analytics"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Analytics />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/notifications"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Notifications />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/inventory"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Inventory />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/eligibility"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Eligibility />
                    </RequireFoodDataAccess>
                  </RequireAuth>
                </Layout>
              }
            />
            <Route
              path="/ngos"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireSuperAdmin>
                      <NgoRegistry />
                    </RequireSuperAdmin>
                  </RequireAuth>
                </Layout>
              }
            />

            <Route path="*" element={<PublicShell><NotFound /></PublicShell>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
