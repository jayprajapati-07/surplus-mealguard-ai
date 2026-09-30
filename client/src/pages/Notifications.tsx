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
      if (window.showToast) window.showToast(isRead ? 'Notification marked as read' : 'Notification marked as unread');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update notification.');
    }
  }

  const shown = showUnreadOnly ? items.filter((n) => !n.isRead) : items;

  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0C2741]">Notification Center</h1>
            <p className="mt-1 text-xs sm:text-sm text-gray-500">
              Surplus-risk alerts, production vs target, target generation, and operational high-waste notices.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-[#006B48]" role="status">{unreadCount} unread</span>
            <button onClick={() => setShowUnreadOnly((v) => !v)} className="rounded-xl border border-[#E3ECE6] bg-white px-3.5 py-1.5 font-semibold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 transition-all cursor-pointer" aria-pressed={showUnreadOnly}>
              {showUnreadOnly ? 'Show all' : 'Unread only'}
            </button>
            <button onClick={() => void load()} className="rounded-xl border border-[#E3ECE6] bg-white px-3.5 py-1.5 font-semibold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 transition-all cursor-pointer">Refresh</button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
      </div>

      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        {loading ? <p className="text-xs sm:text-sm text-gray-500" role="status">Loading notifications…</p> : shown.length === 0 ? (
          <p className="text-xs sm:text-sm text-gray-500">{showUnreadOnly ? 'No unread notifications. Everything is caught up.' : 'No notifications yet. Log records or generate targets to produce them.'}</p>
        ) : (
          <ul className="space-y-3">
            {shown.map((n) => (
              <li key={n.id} className={`rounded-xl border p-4 transition-all ${n.isRead ? 'border-[#E3ECE6] bg-white' : 'border-[#006B48]/30 bg-[#ECFDF5]/30'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[#F2F7F4] px-2 py-0.5 text-xs font-semibold text-[#0C2741]">{n.type}</span>
                  {!n.isRead && <span className="rounded-full bg-[#006B48] px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">unread</span>}
                  <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1.5 font-bold text-[#0C2741] text-sm">{n.title}</p>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-600">{n.body}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {n.linkPath && <Link to={n.linkPath} className="rounded-xl border border-[#E3ECE6] bg-white px-3 py-1.5 font-semibold text-[#006B48] hover:bg-emerald-50 active:scale-95 transition-all">Open details</Link>}
                  <button onClick={() => void setRead(n.id, !n.isRead)} className="rounded-xl border border-[#E3ECE6] bg-white px-3 py-1.5 font-semibold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 transition-all cursor-pointer">
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
