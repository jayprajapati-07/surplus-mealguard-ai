import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

interface AuditEntry {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  user?: {
    name: string;
    email: string;
  } | null;
  metadataJson?: string | null;
  metadata?: unknown;
  createdAt: string;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [limit, setLimit] = useState('100');

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (entityFilter.trim()) params.set('entityType', entityFilter.trim());
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (limit) params.set('limit', limit);

      const qs = params.toString();
      const res = await api<{ entries: AuditEntry[] }>(`/admin/audit-log${qs ? `?${qs}` : ''}`);
      setEntries(res.entries || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  function handleFilterSubmit(e: FormEvent) {
    e.preventDefault();
    fetchLogs();
  }

  function handleReset() {
    setActionFilter('');
    setEntityFilter('');
    setFromDate('');
    setToDate('');
    setLimit('100');
    setTimeout(() => {
      api<{ entries: AuditEntry[] }>('/admin/audit-log?limit=100')
        .then((res) => setEntries(res.entries || []))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load audit logs.'));
    }, 0);
  }

  function formatMetadata(entry: AuditEntry): string {
    if (entry.metadataJson) {
      try {
        const parsed = JSON.parse(entry.metadataJson);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return entry.metadataJson;
      }
    }
    if (entry.metadata) {
      return JSON.stringify(entry.metadata, null, 2);
    }
    return '—';
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">System Audit Log</h1>
          <p className="mt-1 text-sm text-stone-600">
            Immutable log of administrative, operational, authentication, and food redistribution events.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchLogs}
          disabled={loading}
          className="self-start rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh Log'}
        </button>
      </div>

      {/* Filter Bar */}
      <form onSubmit={handleFilterSubmit} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-stone-800">Filter Audit Trail</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="filter-action" className="block text-xs font-medium text-stone-600">Action Keyword</label>
            <input
              id="filter-action"
              type="text"
              placeholder="e.g. login, flow, close"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-leaf-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="filter-entity" className="block text-xs font-medium text-stone-600">Entity Type</label>
            <input
              id="filter-entity"
              type="text"
              placeholder="e.g. DailyFoodRecord"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-leaf-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-stone-600">From Date</label>
            <input
              id="filter-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-leaf-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-stone-600">To Date</label>
            <input
              id="filter-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-leaf-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="filter-limit" className="block text-xs font-medium text-stone-600">Limit</label>
            <select
              id="filter-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-leaf-700 focus:outline-none"
            >
              <option value="25">25 entries</option>
              <option value="50">50 entries</option>
              <option value="100">100 entries</option>
              <option value="200">200 entries</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-50"
          >
            Apply Filters
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </form>

      {/* Error Display */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {/* Audit Log Table */}
      <div className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-stone-500" role="status">
            Loading audit records…
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-stone-800">No audit records found</p>
            <p className="mt-1 text-sm text-stone-500">
              No audit events matched the selected filter criteria. Try adjusting filters or resetting.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Timestamp (UTC)</th>
                  <th scope="col" className="px-4 py-3">Action</th>
                  <th scope="col" className="px-4 py-3">Actor</th>
                  <th scope="col" className="px-4 py-3">Entity</th>
                  <th scope="col" className="px-4 py-3">Details / Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-stone-50/60">
                    <td className="px-4 py-3 text-xs text-stone-600 whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block rounded-md bg-stone-100 px-2 py-0.5 text-xs font-mono font-medium text-stone-800 border border-stone-200">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-700 whitespace-nowrap">
                      {entry.user ? (
                        <div>
                          <div className="font-medium text-stone-900">{entry.user.name}</div>
                          <div className="text-stone-500">{entry.user.email}</div>
                        </div>
                      ) : (
                        <span className="italic text-stone-400">System / Anonymous</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-700">
                      {entry.entityType ? (
                        <div>
                          <span className="font-semibold text-stone-800">{entry.entityType}</span>
                          {entry.entityId && (
                            <span className="ml-1 text-[11px] font-mono text-stone-500">
                              #{entry.entityId.slice(0, 8)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-600 max-w-xs truncate font-mono">
                      <details className="cursor-pointer">
                        <summary className="text-leaf-800 hover:underline">View details</summary>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-stone-100 p-2 text-[11px] text-stone-800 whitespace-pre-wrap">
                          {formatMetadata(entry)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
