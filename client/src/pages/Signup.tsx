import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { useAuth } from '../auth-context';

export function Signup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (name.trim().length < 2) {
      return setError('Please enter your full name (minimum 2 characters).');
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return setError('Please enter a valid email address.');
    }
    if (password.length < 8) {
      return setError('Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match. Please verify your password.');
    }

    setBusy(true);
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });

      // Automatically authenticate the new user and direct to Organization Setup
      try {
        const loginData = await api<{ token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), password }),
        });
        setToken(loginData.token);
        await refresh();
        navigate('/setup', { replace: true });
      } catch {
        // Fallback to login with created banner if auto-login encounters a temporary token issue
        navigate('/login?created=1', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed. Please try again.');
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
        <p className="mt-1 text-xs text-slate-300">Create an Institution Account</p>
      </div>

      <div className="p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Register Organization</h2>
          <p className="text-xs text-slate-500">
            Set up credentials to manage your commercial or campus kitchen.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 flex items-start gap-2" role="alert">
            <span className="font-bold text-rose-600">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
          <div>
            <label htmlFor="su-name" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Full Name
            </label>
            <input
              id="su-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="e.g. Rahul Sharma"
            />
          </div>

          <div>
            <label htmlFor="su-email" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Email / Phone (Work Email)
            </label>
            <input
              id="su-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="admin@college-canteen.edu"
            />
          </div>

          <div>
            <label htmlFor="su-pass" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Password (min. 8 characters)
            </label>
            <input
              id="su-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="su-confirmpass" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Confirm Password
            </label>
            <input
              id="su-confirmpass"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#1565C0] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1565C0] transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 rounded-lg bg-[#0B1F33] py-2.5 px-4 font-semibold text-sm text-white shadow-sm hover:bg-[#1565C0] active:scale-[0.99] disabled:opacity-60 transition-all flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>Creating Account…</span>
              </>
            ) : (
              'CREATE ACCOUNT / SIGN UP'
            )}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <p className="text-xs text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#1565C0] hover:underline">
              LOG IN
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
