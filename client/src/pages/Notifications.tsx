import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface NotificationItem {
  id: string; type: string; title: string; body: string;
  linkPath: string | null; isRead: boolean; createdAt: string;
}

export function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications');
      setItems(d.notifications);
      setUnreadCount(d.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setRead(id: string, isRead: boolean) {
    setError('');
    setMsg('');
    try {
      await api(`/notifications/${id}`, { method: 'PATCH', body: JSON.stringify({ isRead }) });
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, isRead } : n)));
      setUnreadCount((c) => c + (isRead ? -1 : 1));
      setMsg(isRead ? 'Marked as read.' : 'Marked as unread.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update notification.');
    }
  }

  const shown = showUnreadOnly ? items.filter((n) => !n.isRead) : items;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-leaf-900">Notification center</h1>
            <p className="mt-1 text-sm text-stone-600">
              Surplus-risk alerts, production vs target, target generation, and high-waste notices.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-stone-100 px-3 py-1 font-medium" role="status">{unreadCount} unread</span>
            <button onClick={() => setShowUnreadOnly((v) => !v)} className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-100" aria-pressed={showUnreadOnly}>
              {showUnreadOnly ? 'Show all' : 'Unread only'}
            </button>
            <button onClick={() => void load()} className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-100">Refresh</button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        {loading ? <p className="text-sm" role="status">Loading…</p> : shown.length === 0 ? (
          <p className="text-sm text-stone-600">{showUnreadOnly ? 'No unread notifications. Everything is caught up.' : 'No notifications yet. Log Food Flow entries or generate targets to produce them.'}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((n) => (
              <li key={n.id} className={`rounded-xl border p-4 ${n.isRead ? 'border-stone-200' : 'border-leaf-600 bg-leaf-50/40'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium">{n.type}</span>
                  {!n.isRead && <span className="rounded bg-leaf-700 px-1.5 py-0.5 text-xs font-medium text-white">unread</span>}
                  <span className="text-xs text-stone-500">{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 font-medium">{n.title}</p>
                <p className="mt-0.5 text-sm text-stone-600">{n.body}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  {n.linkPath && <Link to={n.linkPath} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">Open details</Link>}
                  <button onClick={() => void setRead(n.id, !n.isRead)} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">
                    {n.isRead ? 'Mark unread' : 'Mark read'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
