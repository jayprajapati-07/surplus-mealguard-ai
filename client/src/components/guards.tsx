import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth-context';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading session…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireOnboarded({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.organizationId) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function RequireNoOrg({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.organizationId) return <Navigate to="/" replace />;
  const allowed = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
  if (!allowed.includes(user.role)) {
    return (
      <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm" role="alert">
        <h1 className="text-lg font-bold text-red-800">Not permitted</h1>
        <p className="mt-2 text-sm text-stone-700">
          Your role ({user.role}) cannot create an organization. Please ask an Institution Admin or Kitchen Manager to
          add you to their organization. This is an intentional role guard for the prototype.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (user) {
    if (user.organizationId) return <Navigate to="/" replace />;
    if (user.role === 'NGO' && user.ngoOrganizationId) return <Navigate to="/redistribution" replace />;
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export const MENU_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
export const IMPORT_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
export const FLOW_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'];
export const REDIST_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'NGO'];
export const AUDIT_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];

function Blocked({ role, what }: { role?: string; what: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm" role="alert">
      <h1 className="text-lg font-bold text-red-800">Not permitted</h1>
      <p className="mt-2 text-sm text-stone-700">
        Your role ({role ?? 'unknown'}) cannot {what}. This is an intentional role guard for the prototype.
      </p>
    </div>
  );
}

function RequireRoles({ roles, what, children }: { roles: string[]; what: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.organizationId) return <Navigate to="/onboarding" replace />;
  if (!roles.includes(user.role)) return <Blocked role={user.role} what={what} />;
  return <>{children}</>;
}

export function RequireMenuAccess({ children }: { children: ReactNode }) {
  return <RequireRoles roles={MENU_ROLES} what="manage food items and menus">{children}</RequireRoles>;
}

export function RequireImportAccess({ children }: { children: ReactNode }) {
  return <RequireRoles roles={IMPORT_ROLES} what="import data files">{children}</RequireRoles>;
}

export function RequireFoodDataAccess({ children }: { children: ReactNode }) {
  return <RequireRoles roles={FLOW_ROLES} what="record Food Flow data">{children}</RequireRoles>;
}

export function RequireMemoryAccess({ children }: { children: ReactNode }) {
  return <RequireRoles roles={FLOW_ROLES} what="view the kitchen digital memory">{children}</RequireRoles>;
}

export function RequireRedistributionAccess({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'NGO') {
    if (!user.ngoOrganizationId) return <Blocked role={user.role} what="view redistribution (NGO account is not linked to a registered NGO)" />;
    return <>{children}</>;
  }
  if (!user.organizationId) return <Navigate to="/onboarding" replace />;
  if (!MENU_ROLES.includes(user.role)) return <Blocked role={user.role} what="view redistribution" />;
  return <>{children}</>;
}

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Blocked role={user.role} what="manage the NGO registry" />;
  return <>{children}</>;
}

export function RequireAuditAccess({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'SUPER_ADMIN') return <>{children}</>;
  if (!user.organizationId) return <Navigate to="/onboarding" replace />;
  if (!AUDIT_ROLES.includes(user.role)) return <Blocked role={user.role} what="view the audit log" />;
  return <>{children}</>;
}

