import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Bell, Plus, Trash2, Send, Check, CheckCheck } from 'lucide-react';
import { orgApi, THREAT_STATUS_OPTIONS } from '../lib/orgApi';

const box = 'rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50';

const SEV = { info: 'bg-blue-500/15 text-blue-300', warning: 'bg-amber-500/15 text-amber-300', critical: 'bg-red-500/15 text-red-300' };
const STATUS = { open: 'bg-amber-500/15 text-amber-300', acknowledged: 'bg-blue-500/15 text-blue-300', resolved: 'bg-green-500/15 text-green-300' };
const Badge = ({ map, v }) => <span className={`px-2 py-0.5 rounded-full text-xs ${map[v] || 'bg-gray-700 text-gray-300'}`}>{v}</span>;

const Alerts = () => {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(() => localStorage.getItem('currentOrgId') || '');
  const [tab, setTab] = useState('center');
  const [err, setErr] = useState('');

  useEffect(() => {
    orgApi.listMyOrgs().then((list) => {
      setOrgs(list || []);
      setOrgId((cur) => {
        const next = (list || []).some((o) => o._id === cur) ? cur : (list?.[0]?._id || '');
        localStorage.setItem('currentOrgId', next);
        return next;
      });
    }).catch((e) => setErr(e.message));
  }, []);

  const selectOrg = (id) => { setOrgId(id); localStorage.setItem('currentOrgId', id); };
  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-md text-sm ${tab === id ? 'bg-blue-500/10 text-blue-400' : 'text-gray-400 hover:text-gray-100'}`}>{label}</button>
  );

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center gap-3">
            <Bell className="text-blue-500" />
            <div>
              <h2 className="text-2xl font-bold text-gray-50">Alerts</h2>
              <p className="text-gray-400 text-sm">Triage fired alerts, and configure rules & notification channels.</p>
            </div>
            <select value={orgId} onChange={(e) => selectOrg(e.target.value)} className={`${box} ml-auto`}>
              {orgs.length === 0 && <option value="">No organizations</option>}
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          </div>

          {err && <div className="text-red-400 text-sm">{err}</div>}

          <div className="flex gap-2 border-b border-gray-800 pb-2">
            <TabBtn id="center" label="Alert Center" />
            <TabBtn id="rules" label="Rules" />
            <TabBtn id="channels" label="Channels" />
          </div>

          {orgId && tab === 'center' && <AlertCenter orgId={orgId} />}
          {orgId && tab === 'rules' && <RulesManager orgId={orgId} />}
          {orgId && tab === 'channels' && <ChannelsManager orgId={orgId} />}
        </div>
      </main>
    </div>
  );
};

// --- Alert Center -----------------------------------------------------------
const AlertCenter = ({ orgId }) => {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setAlerts(await orgApi.listAlerts(orgId, status ? { status } : {})); } catch (e) { setErr(e.message); }
  }, [orgId, status]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { try { await fn(); load(); } catch (e) { setErr(e.message); } };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center justify-between">
        <span>Fired alerts</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${box} py-1 text-sm`}>
          <option value="">all</option><option value="open">open</option>
          <option value="acknowledged">acknowledged</option><option value="resolved">resolved</option>
        </select>
      </CardTitle></CardHeader>
      <CardContent className="p-6">
        {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left border-b border-gray-800">
              <tr><th className="py-2">Severity</th><th>Alert</th><th>Status</th><th>Count</th><th>Last seen</th><th></th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a._id} className="border-b border-gray-800/60">
                  <td className="py-2"><Badge map={SEV} v={a.severity} /></td>
                  <td className="text-gray-100">{a.title || '—'}<div className="text-xs text-gray-500">{a.context?.topSignal || a.context?.status}{a.context?.ip ? ` · ${a.context.ip}` : ''}</div></td>
                  <td><Badge map={STATUS} v={a.status} /></td>
                  <td className="text-gray-300">{a.count}</td>
                  <td className="text-gray-400 text-xs">{a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    {a.status !== 'resolved' && (
                      <>
                        {a.status === 'open' && <button title="Acknowledge" className="text-gray-400 hover:text-blue-400 mr-2" onClick={() => act(() => orgApi.ackAlert(orgId, a._id))}><Check size={16} /></button>}
                        <button title="Resolve" className="text-gray-400 hover:text-green-400" onClick={() => act(() => orgApi.resolveAlert(orgId, a._id))}><CheckCheck size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && <tr><td colSpan={6} className="py-4 text-gray-500">No alerts.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

// --- Rules ------------------------------------------------------------------
const RulesManager = ({ orgId }) => {
  const [rules, setRules] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', severity: 'warning', mode: 'any', statuses: [], riskMin: '', actionBlock: false, channelIds: [], dedupWindowSec: 300 });

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([orgApi.listAlertRules(orgId), orgApi.listAlertChannels(orgId)]);
      setRules(r); setChannels(c);
    } catch (e) { setErr(e.message); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const create = async () => {
    setErr('');
    const leaves = [];
    if (f.statuses.length) leaves.push({ fact: 'status', operator: 'in', value: f.statuses });
    if (f.riskMin !== '') leaves.push({ fact: 'riskScore', operator: 'greaterThanInclusive', value: Number(f.riskMin) });
    if (f.actionBlock) leaves.push({ fact: 'action', operator: 'equal', value: 'block' });
    if (!f.name.trim()) return setErr('Rule name is required');
    if (!leaves.length) return setErr('Add at least one match condition');
    try {
      await orgApi.createAlertRule(orgId, {
        name: f.name.trim(), severity: f.severity,
        conditions: f.mode === 'all' ? { all: leaves } : { any: leaves },
        channelIds: f.channelIds, dedupWindowSec: Number(f.dedupWindowSec) || 300,
      });
      setF({ name: '', severity: 'warning', mode: 'any', statuses: [], riskMin: '', actionBlock: false, channelIds: [], dedupWindowSec: 300 });
      load();
    } catch (e) { setErr(e.message); }
  };
  const toggleEnabled = async (r) => { try { await orgApi.updateAlertRule(orgId, r._id, { enabled: !r.enabled }); load(); } catch (e) { setErr(e.message); } };
  const remove = async (id) => { try { await orgApi.deleteAlertRule(orgId, id); load(); } catch (e) { setErr(e.message); } };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>New alert rule</CardTitle></CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rule name" className={`${box} flex-1 min-w-[200px]`} />
            <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} className={box}>
              <option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
            </select>
            <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className={box} title="Match any or all conditions">
              <option value="any">match ANY</option><option value="all">match ALL</option>
            </select>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Threat statuses</div>
            <div className="flex flex-wrap gap-1">
              {THREAT_STATUS_OPTIONS.map((s) => (
                <button key={s} onClick={() => setF({ ...f, statuses: toggle(f.statuses, s) })}
                  className={`px-2 py-1 rounded text-xs border ${f.statuses.includes(s) ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-gray-400 flex items-center gap-2">riskScore ≥
              <input type="number" min="0" max="100" value={f.riskMin} onChange={(e) => setF({ ...f, riskMin: e.target.value })} placeholder="—" className={`${box} w-20 py-1`} />
            </label>
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <input type="checkbox" checked={f.actionBlock} onChange={(e) => setF({ ...f, actionBlock: e.target.checked })} /> action = block
            </label>
            <label className="text-sm text-gray-400 flex items-center gap-2">dedup window (s)
              <input type="number" min="0" value={f.dedupWindowSec} onChange={(e) => setF({ ...f, dedupWindowSec: e.target.value })} className={`${box} w-24 py-1`} />
            </label>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Notify channels</div>
            {channels.length === 0 ? <div className="text-xs text-gray-500">No channels yet — add one in the Channels tab.</div> : (
              <div className="flex flex-wrap gap-1">
                {channels.map((c) => (
                  <button key={c._id} onClick={() => setF({ ...f, channelIds: toggle(f.channelIds, c._id) })}
                    className={`px-2 py-1 rounded text-xs border ${f.channelIds.includes(c._id) ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{c.name} <span className="text-gray-500">({c.type})</span></button>
                ))}
              </div>
            )}
          </div>
          {err && <div className="text-red-400 text-sm">{err}</div>}
          <button className={btn} onClick={create}><Plus size={16} /> Create rule</button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="p-6">
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r._id} className="flex items-center justify-between border border-gray-800 rounded-md px-3 py-2">
                <div>
                  <div className="text-gray-100 text-sm flex items-center gap-2"><Badge map={SEV} v={r.severity} /> {r.name}</div>
                  <div className="text-xs text-gray-500">{r.channelIds?.length || 0} channel(s) · dedup {r.dedupWindowSec}s{r.snoozedUntil && new Date(r.snoozedUntil) > new Date() ? ' · snoozed' : ''}</div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    <input type="checkbox" checked={r.enabled} onChange={() => toggleEnabled(r)} /> enabled
                  </label>
                  <button className="text-gray-500 hover:text-red-400" onClick={() => remove(r._id)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {rules.length === 0 && <div className="text-gray-500 text-sm">No rules yet.</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// --- Channels ---------------------------------------------------------------
const ChannelsManager = ({ orgId }) => {
  const [channels, setChannels] = useState([]);
  const [type, setType] = useState('webhook');
  const [name, setName] = useState('');
  const [cfg, setCfg] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setChannels(await orgApi.listAlertChannels(orgId)); } catch (e) { setErr(e.message); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setErr(''); setMsg('');
    if (!name.trim()) return setErr('Channel name is required');
    try { await orgApi.createAlertChannel(orgId, { name: name.trim(), type, config: cfg }); setName(''); setCfg({}); load(); }
    catch (e) { setErr(e.message); }
  };
  const test = async (id) => {
    setErr(''); setMsg('');
    try { await orgApi.testAlertChannel(orgId, id); setMsg('Test notification sent.'); }
    catch (e) { setErr(e.message); }
  };
  const remove = async (id) => { try { await orgApi.deleteAlertChannel(orgId, id); load(); } catch (e) { setErr(e.message); } };

  return (
    <Card>
      <CardHeader><CardTitle>Notification channels</CardTitle></CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" className={box} />
          <select value={type} onChange={(e) => { setType(e.target.value); setCfg({}); }} className={box}>
            <option value="webhook">webhook</option><option value="slack">slack</option><option value="email">email</option>
          </select>
          {type === 'email' && <input value={cfg.email || ''} onChange={(e) => setCfg({ email: e.target.value })} placeholder="alerts@company.com" className={`${box} flex-1 min-w-[200px]`} />}
          {type === 'slack' && <input value={cfg.slackWebhookUrl || ''} onChange={(e) => setCfg({ slackWebhookUrl: e.target.value })} placeholder="https://hooks.slack.com/…" className={`${box} flex-1 min-w-[200px]`} />}
          {type === 'webhook' && <>
            <input value={cfg.url || ''} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://your-endpoint/hook" className={`${box} flex-1 min-w-[200px]`} />
            <input value={cfg.secret || ''} onChange={(e) => setCfg({ ...cfg, secret: e.target.value })} placeholder="HMAC secret (optional)" className={box} />
          </>}
          <button className={btn} onClick={create}><Plus size={16} /> Add</button>
        </div>
        {msg && <div className="text-green-400 text-sm">{msg}</div>}
        {err && <div className="text-red-400 text-sm">{err}</div>}

        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c._id} className="flex items-center justify-between border border-gray-800 rounded-md px-3 py-2">
              <div className="text-sm text-gray-100">{c.name} <span className="text-xs text-gray-500">({c.type}){c.enabled === false ? ' · disabled' : ''}</span></div>
              <div className="flex items-center gap-3">
                <button className="text-gray-400 hover:text-blue-400 inline-flex items-center gap-1 text-xs" onClick={() => test(c._id)}><Send size={14} /> Test</button>
                <button className="text-gray-500 hover:text-red-400" onClick={() => remove(c._id)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {channels.length === 0 && <div className="text-gray-500 text-sm">No channels yet.</div>}
        </div>
      </CardContent>
    </Card>
  );
};

export default Alerts;
