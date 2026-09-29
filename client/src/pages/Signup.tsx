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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Please enter your full name (min 2 characters).');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      navigate('/login?created=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Create institution account</h1>
      <p className="mt-1 text-sm text-stone-600">Enter your details to create an account.</p>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="su-name" className="text-sm font-medium">Full name</label>
          <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>
        <div>
          <label htmlFor="su-email" className="text-sm font-medium">Email (must be unique)</label>
          <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>
        <div>
          <label htmlFor="su-pass" className="text-sm font-medium">Password (min 8 characters)</label>
          <input id="su-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="mt-4 text-sm"><Link to="/login" className="text-leaf-800 underline">Back to login</Link></p>
    </div>
  );
}
