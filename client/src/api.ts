const rawBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
export const API_BASE = rawBase.replace(/\/+$/, '');

export function getToken(): string | null {
  return localStorage.getItem('mg_token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('mg_token', token);
  else localStorage.removeItem('mg_token');
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  // 30s timeout unless caller supplies their own signal (e.g. for abort on unmount).
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  const signal = opts.signal ?? ctrl.signal;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${cleanPath}`, { ...opts, headers, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('You appear to be offline. Check your connection and try again.');
    }
    throw new Error('Cannot reach the server. Make sure the API is running and try again.');
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}
