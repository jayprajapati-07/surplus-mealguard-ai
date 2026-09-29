import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken } from '../api';
import { useAuth } from '../auth-context';

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
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Log in</h1>
      <p className="mt-1 text-sm text-stone-600">Access your institution kitchen workspace.</p>
      {created && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          ✓ Account created successfully! Please enter your email and password to log in.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            placeholder="admin@mealguard.local"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </div>
        <button
          type="submit" disabled={busy}
          className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <div className="mt-4 space-y-1 text-sm">
        <p><Link to="/signup" className="text-leaf-800 underline">Create an institution account</Link></p>
        <p><Link to="/forgot" className="text-leaf-800 underline">Forgot password?</Link></p>
      </div>
    </div>
  );
}
