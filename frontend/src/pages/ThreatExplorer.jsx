import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Search, Filter, X } from 'lucide-react';
import { analyticsApi, THREAT_STATUS_OPTIONS } from '../lib/analyticsApi';

const box = 'rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50';

const ACTION_COLORS = { block: 'text-red-300 bg-red-500/15', challenge: 'text-amber-300 bg-amber-500/15', allow: 'text-green-300 bg-green-500/15' };
const riskColor = (r) => (r >= 70 ? 'text-red-400' : r >= 40 ? 'text-amber-400' : 'text-gray-300');

const EMPTY = { status: '', action: '', riskMin: '', riskMax: '', from: '', to: '', fingerprint: '', ip: '', q: '' };

const ThreatExplorer = () => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [draft, setDraft] = useState(EMPTY);   // form state
  const [filters, setFilters] = useState(EMPTY); // applied
  const [events, setEvents] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    analyticsApi.listProjects()
      .then((list) => { setProjects(list || []); if (list?.length) setProjectId(list[0]._id); })
      .catch((e) => setErr(e.message));
  }, []);

  // Build the query params from applied filters (drop empties).
  const buildParams = useCallback((before) => {
    const p = { limit: 50 };
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p[k] = v;
    if (before) p.before = before;
    return p;
  }, [filters]);

  const load = useCallback(async (before) => {
    if (!projectId) return;
    setLoading(true); setErr('');
    try {
      const data = await analyticsApi.searchEvents(projectId, buildParams(before));
      setEvents((prev) => (before ? [...prev, ...data.events] : data.events));
      setNextBefore(data.nextBefore);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [projectId, buildParams]);

  // Reload from the top whenever project or applied filters change.
  useEffect(() => { setEvents([]); setNextBefore(null); load(); }, [projectId, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => setFilters(draft);
  const reset = () => { setDraft(EMPTY); setFilters(EMPTY); };
  const toggleStatus = (s) => setDraft((d) => ({ ...d, status: d.status === s ? '' : s }));
  const activeCount = Object.values(filters).filter((v) => v !== '').length;

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex items-center gap-3">
            <Search className="text-blue-500" />
            <div>
              <h2 className="text-2xl font-bold text-gray-50">Threat Explorer</h2>
              <p className="text-gray-400 text-sm">Search, filter and drill into the security event log.</p>
            </div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${box} ml-auto`}>
              {projects.length === 0 && <option value="">No projects</option>}
              {projects.map((p) => <option key={p._id} value={p._id}>{p.projectName}</option>)}
            </select>
          </div>

          {/* Filter bar */}
          <Card>
            <CardHeader className="pb-3 border-b border-gray-800">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter size={16} className="text-blue-500" /> Filters
                {activeCount > 0 && <span className="text-xs text-gray-500">({activeCount} active)</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div>
                <div className="text-xs text-gray-400 mb-1">Status</div>
                <div className="flex flex-wrap gap-1">
                  {THREAT_STATUS_OPTIONS.map((s) => (
                    <button key={s} onClick={() => toggleStatus(s)}
                      className={`px-2 py-1 rounded text-xs border ${draft.status === s ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} className={box}>
                  <option value="">any action</option><option value="allow">allow</option>
                  <option value="challenge">challenge</option><option value="block">block</option>
                </select>
                <label className="text-xs text-gray-400 flex items-center gap-1">risk ≥
                  <input type="number" min="0" max="100" value={draft.riskMin} onChange={(e) => setDraft({ ...draft, riskMin: e.target.value })} className={`${box} w-20 py-1`} />
                </label>
                <label className="text-xs text-gray-400 flex items-center gap-1">risk ≤
                  <input type="number" min="0" max="100" value={draft.riskMax} onChange={(e) => setDraft({ ...draft, riskMax: e.target.value })} className={`${box} w-20 py-1`} />
                </label>
                <input value={draft.fingerprint} onChange={(e) => setDraft({ ...draft, fingerprint: e.target.value })} placeholder="fingerprint" className={`${box} w-40`} />
                <input value={draft.ip} onChange={(e) => setDraft({ ...draft, ip: e.target.value })} placeholder="ip" className={`${box} w-40`} />
                <input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="search message…" className={`${box} flex-1 min-w-[160px]`} />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <label className="text-xs text-gray-400 flex items-center gap-1">from
                  <input type="datetime-local" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={`${box} py-1`} />
                </label>
                <label className="text-xs text-gray-400 flex items-center gap-1">to
                  <input type="datetime-local" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={`${box} py-1`} />
                </label>
                <button className={btn} onClick={apply}><Search size={14} /> Apply</button>
                <button className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-100 px-2" onClick={reset}><X size={14} /> Reset</button>
              </div>
            </CardContent>
          </Card>

          {err && <div className="text-red-400 text-sm">{err}</div>}

          {/* Results table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-left border-b border-gray-800">
                    <tr>
                      <th className="py-2 px-4">Time</th><th>Status</th><th>Risk</th><th>Action</th>
                      <th>Top signal</th><th>IP</th><th>Country</th><th>Fingerprint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e._id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                        <td className="py-2 px-4 text-gray-400 text-xs whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                        <td><span className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-200">{e.status}</span></td>
                        <td className={`font-mono ${riskColor(e.riskScore || 0)}`}>{e.riskScore != null ? e.riskScore : '—'}</td>
                        <td>{e.action ? <span className={`px-2 py-0.5 rounded-full text-xs ${ACTION_COLORS[e.action] || 'bg-gray-700 text-gray-300'}`}>{e.action}</span> : <span className="text-gray-600">—</span>}</td>
                        <td className="text-gray-300 text-xs">{e.topSignal || '—'}</td>
                        <td className="text-gray-300 font-mono text-xs">{e.ip || '—'}</td>
                        <td className="text-gray-300">{e.country || '—'}</td>
                        <td className="text-gray-400 font-mono text-xs">{e.fingerprint || '—'}</td>
                      </tr>
                    ))}
                    {events.length === 0 && !loading && (
                      <tr><td colSpan={8} className="py-8 text-center text-gray-500">No events match these filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-4 border-t border-gray-800">
                <span className="text-xs text-gray-500">
                  {events.length} event{events.length === 1 ? '' : 's'} · IP shown as stored (IP_STORE_MODE — default truncated /24)
                </span>
                {nextBefore && (
                  <button className={btn} disabled={loading} onClick={() => load(nextBefore)}>
                    {loading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default ThreatExplorer;
