import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Save, ShieldCheck } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const API_URL = import.meta.env.VITE_API_URL || `${API_BASE_URL}/api/v1`;

const NumberField = ({ label, value, onChange, hint }) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    <input
      type="number"
      min="0"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
);

const Settings = () => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [rule, setRule] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    axios.get(`${API_URL}/projects/my-projects`, { withCredentials: true })
      .then((res) => {
        if (res.data.success) {
          setProjects(res.data.data);
          if (res.data.data.length) setProjectId(res.data.data[0]._id);
        }
      })
      .catch((e) => console.error('projects', e));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setStatus('');
    axios.get(`${API_URL}/projects/${projectId}/security-rule`, { withCredentials: true })
      .then((res) => { if (res.data.success) setRule(res.data.data); })
      .catch((e) => console.error('rule', e));
  }, [projectId]);

  const save = async () => {
    if (!rule) return;
    setStatus('saving');
    try {
      const res = await axios.put(`${API_URL}/projects/${projectId}/security-rule`, rule, { withCredentials: true });
      if (res.data.success) { setRule(res.data.data); setStatus('saved'); }
    } catch (e) {
      setStatus('error');
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-blue-500" />
            <div>
              <h2 className="text-2xl font-bold text-gray-50">Security Settings</h2>
              <p className="text-gray-400 text-sm">Rate limits, lockout & bot policy for the selected project.</p>
            </div>
          </div>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100"
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p._id} value={p._id}>{p.projectName}</option>)}
          </select>

          {rule && (
            <Card>
              <CardHeader><CardTitle>Rate Limiting & Protection</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5 p-6">
                <NumberField label="Rate limit (requests)" value={rule.rateLimit} onChange={(v) => setRule({ ...rule, rateLimit: v })} hint="Max requests per window per API key + IP." />
                <NumberField label="Rate window (seconds)" value={rule.rateWindow} onChange={(v) => setRule({ ...rule, rateWindow: v })} />
                <NumberField label="OTP / login-failure limit" value={rule.otpLimit} onChange={(v) => setRule({ ...rule, otpLimit: v })} hint="Failed attempts before lockout." />
                <NumberField label="Ban duration (seconds)" value={rule.banDuration} onChange={(v) => setRule({ ...rule, banDuration: v })} hint="0 disables temporary bans." />
                <div className="flex items-center gap-2">
                  <input id="blockBots" type="checkbox" checked={!!rule.blockBots} onChange={(e) => setRule({ ...rule, blockBots: e.target.checked })} className="h-4 w-4" />
                  <label htmlFor="blockBots" className="text-sm text-gray-300">Block bots</label>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1">Whitelisted IPs (comma-separated)</label>
                  <input
                    type="text"
                    value={(rule.whitelistips || []).join(', ')}
                    onChange={(e) => setRule({ ...rule, whitelistips: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100"
                    placeholder="10.0.0.1, 203.0.113.5"
                  />
                  <p className="text-xs text-gray-500 mt-1">These IPs bypass rate limiting entirely.</p>
                </div>
                <div className="md:col-span-2 flex items-center gap-3">
                  <button onClick={save} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium">
                    <Save size={16} /> Save
                  </button>
                  {status === 'saved' && <span className="text-green-400 text-sm">Saved.</span>}
                  {status === 'saving' && <span className="text-gray-400 text-sm">Saving…</span>}
                  {status === 'error' && <span className="text-red-400 text-sm">Save failed.</span>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Settings;
