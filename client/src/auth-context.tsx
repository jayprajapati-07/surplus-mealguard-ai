import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api';

export interface Kitchen {
  id: string;
  name: string;
  mealTimings: string;
  storageAreas: string;
  foodCategories: string;
  productionCapacityKg: number;
}

export interface Organization {
  id: string;
  name: string;
  sector: string;
  institutionType: string;
  address: string;
  city: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  operatingHours: string;
  peopleServedDaily: number;
  kitchenCapacityKg: number;
  kitchens: Kitchen[];
  profile?: { notes?: string | null; dietaryFocus?: string | null } | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  organizationId: string | null;
  organization?: Organization | null;
  ngoOrganizationId: string | null;
  ngoOrganization?: { id: string; name: string } | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: async () => undefined, signOut: async () => undefined });

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // still clear locally — logout must truly end the session locally
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, refresh, signOut }}>{children}</AuthContext.Provider>;
}
