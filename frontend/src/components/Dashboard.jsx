import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import MetricCard from './MetricCard';
import ActivityChart from './ActivityChart';
import LogsTable from './LogsTable';
import AttackMap from './AttackMap';
import MitreView from './MitreView';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.jsx';
import { useLiveTraffic } from '../hooks/useLiveTraffic';
import { analyticsApi, THREAT_STATUS_OPTIONS } from '../lib/analyticsApi';
import { orgApi } from '../lib/orgApi';
import { Activity, ShieldOff, AlertOctagon, Cpu, Bell } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const API_URL = import.meta.env.VITE_API_URL || `${API_BASE_URL}/api/v1`;

const THREAT_SET = new Set(THREAT_STATUS_OPTIONS);

// Real trend: compare the recent half of a series window against the prior half.
const pctTrend = (prev, recent) => {
  if (prev === 0) return recent > 0 ? { value: '100%', up: true } : { value: '0%', up: true };
  const delta = ((recent - prev) / prev) * 100;
  return { value: `${Math.abs(delta).toFixed(0)}%`, up: delta >= 0 };
};

const Dashboard = () => {
  const [projectId, setProjectId] = useState('');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [projects, setProjects] = useState([]);
  const [apiKeyResult, setApiKeyResult] = useState('');

  const [logs, setLogs] = useState([]);
  const [metrics, setMetrics] = useState({ totalRequests: 0, threatsBlocked: 0, rateLimited: 0, activeSessions: 1, byStatus: {} });
  const [trends, setTrends] = useState({ requests: null, threats: null }); // real deltas from /timeseries
  const [openAlerts, setOpenAlerts] = useState(null);

  const [chartData, setChartData] = useState(
    Array.from({ length: 20 }, (_, i) => ({
      time: new Date(Date.now() - (19 - i) * 5000).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      requests: 0, threats: 0,
    }))
  );
  const chartDataRef = useRef(chartData);
  const currentIntervalCounts = useRef({ requests: 0, threats: 0 });

  // Per-event live accumulation (metrics counters + chart interval), driven by the
  // shared socket hook. Taxonomy uses the canonical THREAT_STATUS_OPTIONS set.
  const onEvent = useCallback((data) => {
    setLogs((prev) => [data, ...prev].slice(0, 50));
    setMetrics((prev) => ({
      ...prev,
      totalRequests: prev.totalRequests + 1,
      threatsBlocked: prev.threatsBlocked + (THREAT_SET.has(data.status) ? 1 : 0),
      rateLimited: prev.rateLimited + (data.status === 'rate-limited' ? 1 : 0),
      byStatus: { ...prev.byStatus, [data.status]: (prev.byStatus?.[data.status] || 0) + 1 },
    }));
    currentIntervalCounts.current.requests += 1;
    if (data.status !== 'success') currentIntervalCounts.current.threats += 1;
  }, []);

  const { connected } = useLiveTraffic(projectId, { limit: 50, onEvent });

  useEffect(() => {
    analyticsApi.listProjects()
      .then((list) => { setProjects(list || []); if (list?.length && !projectId) setProjectId(list[0]._id); })
      .catch((e) => console.error('projects', e));
    // Open-alerts tile — org-scoped; reuse the Alerts page's org selection.
    orgApi.listMyOrgs().then((orgs) => {
      const orgId = localStorage.getItem('currentOrgId') || orgs?.[0]?._id;
      if (orgId) orgApi.listAlerts(orgId, { status: 'open' }).then((a) => setOpenAlerts(a?.length ?? 0)).catch(() => setOpenAlerts(null));
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) return;
    setLogs([]);

    analyticsApi.getAnalytics(projectId)
      .then((data) => { setMetrics({ ...data.metrics, byStatus: data.metrics.byStatus || {} }); setLogs(data.logs || []); })
      .catch((e) => console.error('analytics', e));

    // Seed the live chart with the recent 2h of real history.
    analyticsApi.getTimeseries(projectId, { hours: 2, buckets: 20 })
      .then((data) => {
        const seeded = (data.series || []).map((p) => ({
          time: new Date(p.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }),
          requests: p.requests, threats: p.threats,
        }));
        if (seeded.length) { chartDataRef.current = seeded; setChartData(seeded); }
      })
      .catch((e) => console.error('trends', e));

    // Real 24h series → trend deltas (recent 12h vs prior 12h).
    analyticsApi.getTimeseries(projectId, { hours: 24, buckets: 24 })
      .then((data) => {
        const s = data.series || [];
        if (!s.length) return;
        const half = Math.floor(s.length / 2);
        const sum = (arr, k) => arr.reduce((n, p) => n + (p[k] || 0), 0);
        setTrends({
          requests: pctTrend(sum(s.slice(0, half), 'requests'), sum(s.slice(half), 'requests')),
          threats: pctTrend(sum(s.slice(0, half), 'threats'), sum(s.slice(half), 'threats')),
        });
      })
      .catch(() => {});
  }, [projectId]);

  // Shift the live chart every 5s from accumulated interval counts.
  useEffect(() => {
    const interval = setInterval(() => {
      const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newDataPoint = { time: timeStr, requests: currentIntervalCounts.current.requests, threats: currentIntervalCounts.current.threats };
      currentIntervalCounts.current = { requests: 0, threats: 0 };
      const newChartData = [...chartDataRef.current.slice(1), newDataPoint];
      chartDataRef.current = newChartData;
      setChartData(newChartData);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const createProject = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/projects/create-project`, { projectName: newProjectName, description: newProjectDesc }, { withCredentials: true });
      if (res.data.success) {
        setProjectId(res.data.data._id);
        setShowProjectModal(false);
        setProjects((prev) => [...prev, res.data.data]);
        setNewProjectName(''); setNewProjectDesc('');
      }
    } catch (error) {
      alert('Error creating project: ' + (error.response?.data?.message || error.message));
    }
  };

  const generateApiKey = async () => {
    if (!projectId) { alert('Please select or create a project first.'); return; }
    try {
      const res = await axios.post(`${API_URL}/apikey/create-new-apikey`, { projectId }, { withCredentials: true });
      if (res.data.success) setApiKeyResult(res.data.data.key);
    } catch (error) {
      alert('Error generating API key: ' + (error.response?.data?.message || error.message));
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[30%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <Sidebar />

      <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
        <TopNav connected={connected} projectId={projectId} setProjectId={setProjectId} projects={projects} onConnect={() => {}} />

        <main className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-50">Overview</h2>
                <p className="text-gray-400 mt-1">
                  Real-time security analytics for project{' '}
                  <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-400">{projectId || 'None Selected'}</code>
                </p>
              </div>
              <div className="flex space-x-3">
                <button onClick={() => setShowProjectModal(true)} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition">+ New Project</button>
                <button onClick={generateApiKey} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm font-medium transition">Generate API Key</button>
              </div>
            </div>

            {apiKeyResult && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-md flex justify-between items-center">
                <span><strong>New API Key:</strong> {apiKeyResult}</span>
                <button onClick={() => setApiKeyResult('')} className="text-green-500 hover:text-green-300">Dismiss</button>
              </div>
            )}

            {showProjectModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Create New Project</h3>
                  <form onSubmit={createProject} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Project Name</label>
                      <input required type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                      <input type="text" value={newProjectDesc} onChange={(e) => setNewProjectDesc(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-blue-500 outline-none" />
                    </div>
                    <div className="flex justify-end space-x-3 pt-2">
                      <button type="button" onClick={() => setShowProjectModal(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-sm">Cancel</button>
                      <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium">Create</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Metrics Row — real trends where series data exists */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Total API Requests" value={metrics.totalRequests.toLocaleString()} icon={<Activity size={24} />} trend={trends.requests?.value} trendUp={trends.requests?.up} />
              <MetricCard title="Threats Blocked" value={metrics.threatsBlocked.toLocaleString()} icon={<ShieldOff size={24} />} trend={trends.threats?.value} trendUp={trends.threats?.up} />
              <MetricCard title="Rate Limits Hit" value={metrics.rateLimited.toLocaleString()} icon={<AlertOctagon size={24} />} trend={null} />
              <MetricCard title="Active Sessions" value={metrics.activeSessions.toLocaleString()} icon={<Cpu size={24} />} trend={null} />
            </div>

            {/* Chart + open-alerts tile */}
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
              <ActivityChart data={chartData} />
              <Card className="col-span-3 flex flex-col justify-center">
                <CardContent className="p-6 text-center">
                  <div className="rounded-xl p-3 bg-amber-500/10 text-amber-400 inline-flex"><Bell size={24} /></div>
                  <p className="text-sm font-medium text-gray-400 mt-3">Open Alerts</p>
                  <h4 className="mt-1 text-4xl font-bold tracking-tight text-gray-50">{openAlerts == null ? '—' : openAlerts}</h4>
                  <p className="text-xs text-gray-500 mt-2">across your organization</p>
                </CardContent>
              </Card>
            </div>

            {/* Attack Map + MITRE */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AttackMap projectId={projectId} hours={24} />
              <MitreView byStatus={metrics.byStatus} />
            </div>

            {/* Live logs (full width) */}
            <div className="h-[420px]">
              <LogsTable logs={logs} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
