import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import LogsTable from '../components/LogsTable';
import { useLiveTraffic } from '../hooks/useLiveTraffic';
import { analyticsApi } from '../lib/analyticsApi';
import { Radio } from 'lucide-react';

const LiveTraffic = () => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const { logs, connected } = useLiveTraffic(projectId, { limit: 100 });

  useEffect(() => {
    analyticsApi.listProjects()
      .then((list) => {
        setProjects(list || []);
        if (list?.length) setProjectId(list[0]._id);
      })
      .catch((e) => console.error(e));
  }, []);

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-hidden p-6 flex flex-col">
        <div className="mx-auto max-w-4xl w-full flex-1 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Radio className="text-blue-500" />
              <div>
                <h2 className="text-2xl font-bold text-gray-50">Live Traffic</h2>
                <p className="text-gray-400 text-sm">Real-time stream of security events.</p>
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${connected ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-gray-100 w-fit">
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p._id} value={p._id}>{p.projectName}</option>)}
          </select>

          <div className="flex-1 min-h-0">
            <LogsTable logs={logs} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default LiveTraffic;
