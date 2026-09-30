import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken } from '../api';
import { useAuth, type User } from '../auth-context';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const created = searchParams.get('created');
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setToken(data.token);
      
      // Fetch authenticated user to verify organization setup state
      const meData = await api<{ user: User }>('/auth/me');
      await refresh();

      // If organization setup is incomplete -> /setup; if complete -> /dashboard
      if (!meData.user.organizationId) {
        navigate('/setup', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="bg-[#0B1F33] px-6 py-6 text-white text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2E7D32] text-2xl shadow-sm">
          🌱
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white">Surplus MealGuard AI</h1>
        <p className="mt-1 text-xs text-slate-300">Institutional Food Production & Waste Prevention Platform</p>
      </div>

      <div className="p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Sign In</h2>
          <p className="text-xs text-slate-500">Access your organization kitchen workspace and dashboards.</p>
        </div>

        {created && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-start gap-2" role="status">
            <span className="font-bold text-emerald-600">✓</span>
            <span>Account created successfully! Please enter your credentials to log in.</span>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 flex items-start gap-2" role="alert">
            <span className="font-bold text-rose-600">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Email / Phone
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="admin@mealguard.local"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Password
              </label>
              <Link to="/forgot" className="text-xs font-medium text-[#1565C0] hover:underline">
                Forgot Password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#0B1F33] py-2.5 px-4 font-semibold text-sm text-white shadow-sm hover:bg-[#1565C0] active:scale-[0.99] disabled:opacity-60 transition-all flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>Signing in…</span>
              </>
            ) : (
              'LOGIN'
            )}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <p className="text-xs text-slate-600">
            Don't have an organization account?{' '}
            <Link to="/signup" className="font-semibold text-[#1565C0] hover:underline">
              SIGN UP
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
