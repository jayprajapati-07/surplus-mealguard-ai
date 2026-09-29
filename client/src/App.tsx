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
  RequireMemoryAccess,
  RequireRedistributionAccess,
  RequireSuperAdmin,
  RequireAuditAccess,
} from './components/guards';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Forgot, Reset } from './pages/AuthExtras';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { OrganizationPage } from './pages/Organization';
import { MenuPage } from './pages/MenuPage';
import { FoodData } from './pages/FoodData';
import { Imports } from './pages/Imports';
import { DigitalMemory } from './pages/DigitalMemory';
import { Flow } from './pages/Flow';
import { Notifications } from './pages/Notifications';
import { Inventory } from './pages/Inventory';
import { EndOfDay } from './pages/EndOfDay';
import { Waste } from './pages/Waste';
import { Eligibility } from './pages/Eligibility';
import { Redistribution } from './pages/Redistribution';
import { NgoRegistry } from './pages/NgoRegistry';
import { Analytics } from './pages/Analytics';
import { Reports } from './pages/Reports';
import { AuditLog } from './pages/AuditLog';
import { DemoGuide } from './pages/DemoGuide';

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-700 text-lg text-white" aria-hidden="true">♻</div>
          <div>
            <p className="text-base font-bold text-leaf-900">Surplus MealGuard AI</p>
            <p className="text-xs text-stone-500">Smart Food Waste Prevention &amp; Redistribution (SIH Prototype)</p>
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
        <Link to="/" className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800">
          Go home
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
            <Route path="/login" element={<PublicShell><PublicOnly><Login /></PublicOnly></PublicShell>} />
            <Route path="/signup" element={<PublicShell><PublicOnly><Signup /></PublicOnly></PublicShell>} />
            <Route path="/forgot" element={<PublicShell><Forgot /></PublicShell>} />
            <Route path="/reset" element={<PublicShell><Reset /></PublicShell>} />
            <Route path="/verify" element={<Navigate to="/login" replace />} />
            <Route
              path="/onboarding"
              element={
                <Layout>
                  <RequireNoOrg><Onboarding /></RequireNoOrg>
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
              path="/demo-guide"
              element={
                <Layout>
                  <RequireAuth>
                    <DemoGuide />
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
              path="/memory"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireMemoryAccess>
                      <DigitalMemory />
                    </RequireMemoryAccess>
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
              path="/flow"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireFoodDataAccess>
                      <Flow />
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
            <Route
              path="/audit"
              element={
                <Layout>
                  <RequireAuth>
                    <RequireAuditAccess>
                      <AuditLog />
                    </RequireAuditAccess>
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
