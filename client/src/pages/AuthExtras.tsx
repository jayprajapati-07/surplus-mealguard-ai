import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function Forgot() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    setBusy(true);
    try {
      const data = await api<{ message: string }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      setMsg(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Forgot password</h1>
      <p className="mt-1 text-sm text-stone-600">Enter your email to request a password reset token.</p>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="fp-email" className="text-sm font-medium">Account email</label>
          <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Sending…' : 'Request reset token'}
        </button>
      </form>
      <div className="mt-4 space-y-1 text-sm">
        <p><Link to="/reset" className="text-leaf-800 underline">Reset password with token</Link></p>
        <p><Link to="/login" className="text-leaf-800 underline">Back to login</Link></p>
      </div>
    </div>
  );
}

export function Reset() {
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    if (token.trim().length < 10) return setError('Please enter a valid reset token.');
    if (pw.length < 8) return setError('New password must be at least 8 characters.');
    setBusy(true);
    try {
      const data = await api<{ message: string }>('/auth/reset', { method: 'POST', body: JSON.stringify({ token: token.trim(), newPassword: pw }) });
      setMsg(data.message);
      setToken('');
      setPw('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Reset password</h1>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="rs-token" className="text-sm font-medium">Reset token</label>
          <input id="rs-token" value={token} onChange={(e) => setToken(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm" placeholder="Enter reset token" />
        </div>
        <div>
          <label htmlFor="rs-pw" className="text-sm font-medium">New password (min 8)</label>
          <input id="rs-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
      <p className="mt-4 text-sm"><Link to="/login" className="text-leaf-800 underline">Back to login</Link></p>
    </div>
  );
}

export function Verify() {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    if (token.trim().length < 10) return setError('Please enter a valid verification token.');
    setBusy(true);
    try {
      const data = await api<{ message: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ token: token.trim() }) });
      setMsg(`${data.message} You can now log in.`);
      setToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Verify email</h1>
      <p className="mt-1 text-sm text-stone-600">Enter your verification token to verify your account.</p>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="vf-token" className="text-sm font-medium">Verification token</label>
          <input id="vf-token" value={token} onChange={(e) => setToken(e.target.value)} required className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm" placeholder="Enter verification token" />
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Verifying…' : 'Verify email'}
        </button>
      </form>
      <div className="mt-4 space-y-1 text-sm">
        <p><Link to="/login" className="text-leaf-800 underline">Back to login</Link></p>
      </div>
    </div>
  );
}
