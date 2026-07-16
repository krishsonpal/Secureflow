import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Building2, Users, UserPlus, Trash2, Plus, KeyRound, Copy, Check } from 'lucide-react';
import { orgApi, ROLE_OPTIONS } from '../lib/orgApi';

const box = 'rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50';

const Organization = () => {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(() => localStorage.getItem('currentOrgId') || '');
  const [err, setErr] = useState('');

  const loadOrgs = useCallback(async () => {
    try {
      const list = await orgApi.listMyOrgs();
      setOrgs(list || []);
      setOrgId((cur) => {
        const valid = (list || []).some((o) => o._id === cur);
        const next = valid ? cur : (list?.[0]?._id || '');
        localStorage.setItem('currentOrgId', next);
        return next;
      });
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const selectOrg = (id) => { setOrgId(id); localStorage.setItem('currentOrgId', id); };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center gap-3">
            <Building2 className="text-blue-500" />
            <div>
              <h2 className="text-2xl font-bold text-gray-50">Organization</h2>
              <p className="text-gray-400 text-sm">Members, roles, teams, and environment-scoped API keys.</p>
            </div>
          </div>

          {err && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{err}</div>}

          <OrgSwitcher orgs={orgs} orgId={orgId} onSelect={selectOrg} onCreated={loadOrgs} />

          {orgId && (
            <>
              <MembersCard orgId={orgId} />
              <TeamsCard orgId={orgId} />
              <EnvironmentsCard />
            </>
          )}
        </div>
      </main>
    </div>
  );
};

// --- Org switcher + create --------------------------------------------------
const OrgSwitcher = ({ orgs, orgId, onSelect, onCreated }) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await orgApi.createOrg(name.trim()); setName(''); setCreating(false); await onCreated(); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-400">Current org</label>
        <select value={orgId} onChange={(e) => onSelect(e.target.value)} className={box}>
          {orgs.length === 0 && <option value="">No organizations</option>}
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </select>
        {!creating
          ? <button className={btn} onClick={() => setCreating(true)}><Plus size={16} /> New org</button>
          : (
            <div className="flex items-center gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Org name" className={box}
                     onKeyDown={(e) => e.key === 'Enter' && create()} />
              <button className={btn} disabled={busy} onClick={create}>Create</button>
              <button className="text-gray-400 text-sm hover:text-gray-200" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          )}
      </CardContent>
    </Card>
  );
};

// --- Members ----------------------------------------------------------------
const MembersCard = ({ orgId }) => {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setMembers(await orgApi.listMembers(orgId)); } catch (e) { setErr(e.message); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const orgRole = (m) => (m.grants.find((g) => g.scopeType === 'org') || m.grants[0])?.role || '—';

  const invite = async () => {
    setErr(''); setMsg('');
    try {
      const r = await orgApi.invite(orgId, email.trim(), role);
      setEmail('');
      setMsg(r.acceptUrl ? `Invited ${r.email}. Dev accept link: ${r.acceptUrl}` : `Invited ${r.email}.`);
      load();
    } catch (e) { setErr(e.message); }
  };

  const setMemberRole = async (userId, newRole) => {
    setErr('');
    try { await orgApi.changeRole(orgId, userId, newRole); load(); } catch (e) { setErr(e.message); }
  };
  const remove = async (userId) => {
    setErr('');
    try { await orgApi.removeMember(orgId, userId); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Users size={18} /> Members</CardTitle></CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-gray-400 mb-1">Invite by email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" className={`${box} w-full`} />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={box}>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className={btn} disabled={!email.trim()} onClick={invite}><UserPlus size={16} /> Invite</button>
        </div>
        {msg && <div className="text-green-400 text-xs break-all">{msg}</div>}
        {err && <div className="text-red-400 text-sm">{err}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left border-b border-gray-800">
              <tr><th className="py-2">User</th><th>Email</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b border-gray-800/60">
                  <td className="py-2 text-gray-100">{m.username || m.userId}</td>
                  <td className="text-gray-400">{m.email}</td>
                  <td>
                    <select value={orgRole(m)} onChange={(e) => setMemberRole(m.userId, e.target.value)} className={`${box} py-1`}>
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="text-right">
                    <button onClick={() => remove(m.userId)} className="text-gray-500 hover:text-red-400" title="Remove"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan={4} className="py-4 text-gray-500">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

// --- Teams ------------------------------------------------------------------
const TeamsCard = ({ orgId }) => {
  const [teams, setTeams] = useState([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setTeams(await orgApi.listTeams(orgId)); } catch (e) { setErr(e.message); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setErr('');
    try { await orgApi.createTeam(orgId, name.trim()); setName(''); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Teams</CardTitle></CardHeader>
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" className={box}
                 onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className={btn} disabled={!name.trim()} onClick={create}><Plus size={16} /> Add team</button>
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <span key={t._id} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-full px-3 py-1 text-sm text-gray-200">
              {t.name}{t.isDefault && <span className="text-xs text-blue-400">(default)</span>}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// --- Environments & API keys ------------------------------------------------
const EnvironmentsCard = () => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [envs, setEnvs] = useState([]);
  const [newEnv, setNewEnv] = useState('');
  const [keyEnvId, setKeyEnvId] = useState('');
  const [revealed, setRevealed] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    orgApi.listProjects().then((ps) => {
      setProjects(ps || []);
      if (ps?.length) setProjectId(ps[0]._id);
    }).catch((e) => setErr(e.message));
  }, []);

  const loadEnvs = useCallback(async () => {
    if (!projectId) return;
    try { const e = await orgApi.listEnvironments(projectId); setEnvs(e); setKeyEnvId(e?.[0]?._id || ''); }
    catch (ex) { setErr(ex.message); }
  }, [projectId]);
  useEffect(() => { loadEnvs(); }, [loadEnvs]);

  const addEnv = async () => {
    if (!newEnv.trim()) return;
    setErr('');
    try { await orgApi.createEnvironment(projectId, newEnv.trim()); setNewEnv(''); loadEnvs(); } catch (e) { setErr(e.message); }
  };
  const createKey = async () => {
    setErr(''); setRevealed(null); setCopied(false);
    try { const k = await orgApi.createApiKey(projectId, keyEnvId || undefined); setRevealed(k); } catch (e) { setErr(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound size={18} /> Environments & API Keys</CardTitle></CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-400">Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={box}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p._id} value={p._id}>{p.projectName}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {envs.map((e) => (
              <span key={e._id} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-full px-3 py-1 text-sm text-gray-200">
                {e.name}{e.isDefault && <span className="text-xs text-blue-400">(default)</span>}
              </span>
            ))}
          </div>
          <input value={newEnv} onChange={(e) => setNewEnv(e.target.value)} placeholder="e.g. staging" className={box}
                 onKeyDown={(e) => e.key === 'Enter' && addEnv()} />
          <button className={btn} disabled={!projectId || !newEnv.trim()} onClick={addEnv}><Plus size={16} /> Add env</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-4">
          <label className="text-sm text-gray-400">New API key for</label>
          <select value={keyEnvId} onChange={(e) => setKeyEnvId(e.target.value)} className={box}>
            {envs.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}
          </select>
          <button className={btn} disabled={!projectId} onClick={createKey}><KeyRound size={16} /> Create key</button>
        </div>

        {revealed && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 space-y-2">
            <p className="text-amber-300 text-xs">Copy this key now — it will not be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-sm text-gray-100 bg-gray-900 rounded px-2 py-1">{revealed.key}</code>
              <button className="text-gray-300 hover:text-white" title="Copy"
                onClick={() => { navigator.clipboard?.writeText(revealed.key); setCopied(true); }}>
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}
        {err && <div className="text-red-400 text-sm">{err}</div>}
      </CardContent>
    </Card>
  );
};

export default Organization;
