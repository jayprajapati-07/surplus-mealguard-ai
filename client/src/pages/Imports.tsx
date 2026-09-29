import { useCallback, useEffect, useState } from 'react';
import { API_BASE, api, getToken } from '../api';
import { useAuth } from '../auth-context';

interface Suggestion {
  column: string | null;
  confidence: 'high' | 'medium' | 'none';
}

interface ParseResult {
  filename: string;
  headers: string[];
  mapping: Record<string, Suggestion>;
  needsMapping: boolean;
  rowCount: number;
  preview: Record<string, unknown>[];
  notice: string;
}

interface ImportJob {
  id: string;
  fileName: string;
  status: string;
  totalRows: number | null;
  successRows: number | null;
  errorRows: number | null;
  createdAt: string;
}

const EXPECTED = ['date', 'food', 'target', 'produced', 'sold', 'waste', 'surplus', 'meal', 'unit', 'kitchen'] as const;

export function Imports() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [kitchenId, setKitchenId] = useState('');
  const [defaultMeal, setDefaultMeal] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ message: string; accepted: number; duplicates: number; invalid: number; skipped: number; createdFoods: number; job: { id: string } } | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [jobDetail, setJobDetail] = useState<{ job: ImportJob & { errors: { id: string; rowNumber: number; errorMessage: string; rawDataJson: string | null }[] } } | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const d = await api<{ jobs: ImportJob[] }>('/imports/jobs');
      setJobs(d.jobs);
    } catch {
      // jobs list is a convenience; main flow does not depend on it
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  async function authedFetch(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }

  async function onParse() {
    setError('');
    setResult(null);
    setJobDetail(null);
    if (!file) return setError('Please choose a .csv, .xlsx, or .xls file first.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authedFetch('/imports/parse', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not read this file.');
      const p = data as ParseResult;
      setParsed(p);
      const initial: Record<string, string> = {};
      for (const f of EXPECTED) {
        if (p.mapping[f]?.column) initial[f] = p.mapping[f].column as string;
      }
      setMapping(initial);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'Parse failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setError('');
    if (!file || !parsed) return setError('Upload and detect columns first.');
    if (!kitchenId) return setError('Please choose the kitchen/unit this file belongs to.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kitchenUnitId', kitchenId);
      fd.append('mapping', JSON.stringify(mapping));
      if (defaultMeal) fd.append('defaultMeal', defaultMeal);
      const res = await authedFetch('/imports/confirm', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Import failed.');
      setResult(data);
      setParsed(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openJob(id: string) {
    setError('');
    try {
      const d = await api<{ job: ImportJob & { errors: { id: string; rowNumber: number; errorMessage: string; rawDataJson: string | null }[] } }>(`/imports/jobs/${id}`);
      setJobDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load job.');
    }
  }

  async function downloadErrorCsv(id: string) {
    try {
      const res = await authedFetch(`/imports/jobs/${id}/errors.csv`, { method: 'GET' });
      if (!res.ok) throw new Error('Download failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-errors-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-leaf-900">Imports (CSV / Excel)</h1>
        <p className="mt-1 text-sm text-stone-600">
          Expected columns: Date, Food Item, Target, Produced, Sold, Waste, Surplus/Remaining, Meal, Unit. Kitchen comes from your selection below (or a Kitchen column). Units are standardized to kilograms; unknown units are flagged, never guessed. Nothing is silently discarded.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <a href={`${API_BASE}/imports/templates/csv`} className="rounded-lg border border-stone-300 px-3 py-1.5 font-medium hover:bg-stone-100" download>
            Download sample CSV template
          </a>
          <a href={`${API_BASE}/imports/templates/xlsx`} className="rounded-lg border border-stone-300 px-3 py-1.5 font-medium hover:bg-stone-100" download>
            Download sample XLSX template
          </a>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">1 · Choose file &amp; kitchen</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="im-file" className="text-sm font-medium">File (.csv, .xlsx, .xls)</label>
            <input id="im-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParsed(null); setResult(null); }} className="mt-1 w-full text-sm" />
          </div>
          <div>
            <label htmlFor="im-kit" className="text-sm font-medium">Kitchen/unit for these rows</label>
            <select id="im-kit" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2">
              <option value="">— Choose —</option>
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="im-meal" className="text-sm font-medium">Default meal (if column missing)</label>
            <select id="im-meal" value={defaultMeal} onChange={(e) => setDefaultMeal(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2">
              <option value="">— None —</option>
              <option value="BREAKFAST">Breakfast</option>
              <option value="LUNCH">Lunch</option>
              <option value="DINNER">Dinner</option>
            </select>
          </div>
        </div>
        <button onClick={onParse} disabled={busy || !file} className="mt-3 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Reading…' : 'Upload & detect columns'}
        </button>
      </div>

      {parsed && (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">2 · Confirm column mapping ({parsed.rowCount} data rows in {parsed.filename})</h2>
          <p className={`mt-1 rounded-lg p-2 text-sm ${parsed.needsMapping ? 'bg-amber-50 text-amber-900' : 'bg-leaf-100 text-leaf-900'}`} role="status">{parsed.notice}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {EXPECTED.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <label htmlFor={`map-${f}`} className="w-28 font-medium capitalize">{f}</label>
                <select id={`map-${f}`} value={mapping[f] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))} className="flex-1 rounded-lg border border-stone-300 px-2 py-1">
                  <option value="">— Not mapped —</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className={`rounded px-1.5 py-0.5 text-xs ${parsed.mapping[f]?.confidence === 'high' ? 'bg-leaf-100 text-leaf-900' : parsed.mapping[f]?.confidence === 'medium' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-700'}`}>
                  {parsed.mapping[f]?.confidence ?? 'none'}
                </span>
              </div>
            ))}
          </div>
          {parsed.preview.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <p className="text-sm font-medium">Preview (first rows)</p>
              <table className="mt-1 w-full text-xs">
                <thead><tr>{parsed.headers.map((h) => <th key={h} className="border border-stone-200 bg-stone-50 px-2 py-1 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {parsed.preview.map((row, i) => (
                    <tr key={i}>{parsed.headers.map((h) => <td key={h} className="border border-stone-200 px-2 py-1">{String(row[h] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={onConfirm} disabled={busy} className="mt-3 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
            {busy ? 'Importing…' : 'Confirm & import'}
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-leaf-200 bg-white p-6 shadow-sm" role="status">
          <h2 className="font-bold text-leaf-900">Import result</h2>
          <p className="mt-1 text-sm">{result.message}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="rounded bg-leaf-100 p-2"><dt>Accepted</dt><dd className="text-lg font-bold">{result.accepted}</dd></div>
            <div className="rounded bg-stone-100 p-2"><dt>Duplicates</dt><dd className="text-lg font-bold">{result.duplicates}</dd></div>
            <div className="rounded bg-red-50 p-2"><dt>Invalid</dt><dd className="text-lg font-bold">{result.invalid}</dd></div>
            <div className="rounded bg-stone-100 p-2"><dt>Skipped</dt><dd className="text-lg font-bold">{result.skipped}</dd></div>
            <div className="rounded bg-blue-50 p-2"><dt>Foods created</dt><dd className="text-lg font-bold">{result.createdFoods}</dd></div>
          </dl>
          <div className="mt-2 flex gap-2 text-sm">
            <button onClick={() => openJob(result.job.id)} className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-100">View error table</button>
            <button onClick={() => downloadErrorCsv(result.job.id)} className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-100">Download error report CSV</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Recent import jobs ({jobs.length})</h2>
          <button onClick={() => void loadJobs()} className="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100">Refresh</button>
        </div>
        {jobs.length === 0 ? <p className="mt-2 text-sm text-stone-600">No imports yet.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 p-3">
                <div>
                  <p className="font-bold">{j.fileName} <span className="ml-1 rounded bg-stone-200 px-1.5 py-0.5 text-xs">{j.status}</span></p>
                  <p className="text-stone-600">{new Date(j.createdAt).toLocaleString()} · {j.successRows ?? 0} ok / {j.errorRows ?? 0} errors of {j.totalRows ?? 0} rows</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openJob(j.id)} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Details</button>
                  <button onClick={() => downloadErrorCsv(j.id)} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Error CSV</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {jobDetail && (
          <div className="mt-3 rounded-xl bg-stone-50 p-3">
            <p className="text-sm font-bold">Error table for {jobDetail.job.fileName} ({jobDetail.job.errors.length})</p>
            {jobDetail.job.errors.length === 0 ? <p className="mt-1 text-sm text-stone-600">No errors — every row was accepted.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {jobDetail.job.errors.map((e) => (
                  <li key={e.id} className="rounded border border-stone-200 bg-white p-2">
                    <p><strong>Row {e.rowNumber}:</strong> {e.errorMessage}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
