import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Bug, UserX, Ghost, ShieldAlert, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const API_URL = import.meta.env.VITE_API_URL || `${API_BASE_URL}/api/v1`;

const STATUS_META = {
  success: { label: 'Success', color: 'text-green-400', icon: <CheckCircle2 /> },
  xss: { label: 'XSS Blocked', color: 'text-rose-400', icon: <Bug /> },
  'session-theft': { label: 'Session Theft', color: 'text-fuchsia-400', icon: <UserX /> },
  bot: { label: 'Bots', color: 'text-orange-400', icon: <Ghost /> },
  failed: { label: 'Failed Logins', color: 'text-red-400', icon: <ShieldAlert /> },
  locked: { label: 'Locked', color: 'text-red-400', icon: <ShieldAlert /> },
  'rate-limited': { label: 'Rate Limited', color: 'text-yellow-400', icon: <AlertTriangle /> },
};

const ThreatAnalysis = () => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [byStatus, setByStatus] = useState({});
  const [metrics, setMetrics] = useState({ totalRequests: 0, threatsBlocked: 0, rateLimited: 0 });

  useEffect(() => {
    axios.get(`${API_URL}/projects/my-projects`, { withCredentials: true })
      .then((res) => {
        if (res.data.success) {
          setProjects(res.data.data);
          if (res.data.data.length) setProjectId(res.data.data[0]._id);
        }
      })
      .catch((e) => console.error(e));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    axios.get(`${API_URL}/projects/${projectId}/analytics`, { withCredentials: true })
      .then((res) => {
        if (res.data.success) {
          setMetrics(res.data.data.metrics);
          setByStatus(res.data.data.metrics.byStatus || {});
        }
      })
      .catch((e) => console.error(e));
  }, [projectId]);

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <Activity className="text-blue-500" />
            <div>
              <h2 className="text-2xl font-bold text-gray-50">Threat Analysis</h2>
              <p className="text-gray-400 text-sm">Breakdown of request outcomes by type.</p>
            </div>
          </div>

          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100">
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p._id} value={p._id}>{p.projectName}</option>)}
          </select>

          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="p-6"><p className="text-sm text-gray-400">Total Requests</p><h4 className="text-3xl font-bold mt-2">{metrics.totalRequests}</h4></CardContent></Card>
            <Card><CardContent className="p-6"><p className="text-sm text-gray-400">Threats Blocked</p><h4 className="text-3xl font-bold mt-2 text-red-400">{metrics.threatsBlocked}</h4></CardContent></Card>
            <Card><CardContent className="p-6"><p className="text-sm text-gray-400">Rate Limited</p><h4 className="text-3xl font-bold mt-2 text-yellow-400">{metrics.rateLimited}</h4></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Outcomes by type</CardTitle></CardHeader>
            <CardContent className="p-6 space-y-4">
              {entries.length === 0 && <p className="text-gray-500 text-sm">No events recorded yet.</p>}
              {entries.map(([status, count]) => {
                const meta = STATUS_META[status] || { label: status, color: 'text-gray-400', icon: <Activity /> };
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`flex items-center gap-2 text-sm font-medium ${meta.color}`}>{meta.icon} {meta.label}</span>
                      <span className="text-sm text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-800">
                      <div className={`h-2 rounded-full ${status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default ThreatAnalysis;
