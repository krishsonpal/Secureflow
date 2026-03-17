import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import MetricCard from './MetricCard';
import ActivityChart from './ActivityChart';
import LogsTable from './LogsTable';
import { Activity, ShieldOff, AlertOctagon, Cpu } from 'lucide-react';

const Dashboard = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
  const API_URL = import.meta.env.VITE_API_URL || `${API_BASE_URL}/api/v1`;
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [projectId, setProjectId] = useState('');
  
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [projects, setProjects] = useState([]);
  
  const [apiKeyResult, setApiKeyResult] = useState('');

  
  const [logs, setLogs] = useState([]);
  const [metrics, setMetrics] = useState({
    totalRequests: 0,
    threatsBlocked: 0,
    rateLimited: 0,
    activeSessions: 1,
  });

  // Chart data: past 20 time slices
  const [chartData, setChartData] = useState(
    Array.from({ length: 20 }, (_, i) => ({
      time: new Date(Date.now() - (19 - i) * 5000).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' }),
      requests: 0,
      threats: 0,
    }))
  );

  const chartDataRef = useRef(chartData);
  const currentIntervalCounts = useRef({ requests: 0, threats: 0 });

  useEffect(() => {
    // Connect to Socket.IO server
    const newSocket = io(API_BASE_URL, {
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
      if (projectId) {
        newSocket.emit('join-project', projectId);
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    // Listen for real-time dashboard updates
    newSocket.on('dashboard-update', (data) => {
      // 1. Update Logs List (limit to 50)
      setLogs((prev) => [data, ...prev].slice(0, 50));

      // 2. Update Metrics Counters
      setMetrics((prev) => {
        const isThreat = ['failed', 'locked', 'xss', 'session-theft', 'bot'].includes(data.status);
        const isRateLimit = data.status === 'rate-limited';
        return {
          ...prev,
          totalRequests: prev.totalRequests + 1,
          threatsBlocked: prev.threatsBlocked + (isThreat ? 1 : 0),
          rateLimited: prev.rateLimited + (isRateLimit ? 1 : 0),
        };
      });

      // 3. Accumulate data for the current chart interval
      currentIntervalCounts.current.requests += 1;
      if (data.status !== 'success') {
        currentIntervalCounts.current.threats += 1;
      }
    });

    // Fetch user's projects
    const fetchProjects = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects/my-projects`, { withCredentials: true });
        if (res.data.success) {
          setProjects(res.data.data);
          if (res.data.data.length > 0 && !projectId) {
            setProjectId(res.data.data[0]._id);
          }
        }
      } catch (error) {
        console.error('Error fetching projects:', error);
      }
    };
    fetchProjects();

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;

    const fetchAnalytics = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects/${projectId}/analytics`, { withCredentials: true });
        if (res.data.success) {
          setMetrics(res.data.data.metrics);
          setLogs(res.data.data.logs);
        }
      } catch (error) {
        console.error('Error fetching analytics:', error);
      }
    };
    
    fetchAnalytics();
  }, [projectId]);

  // Auto-join socket room when project or connection changes
  useEffect(() => {
    if (socket && connected && projectId) {
      socket.emit('join-project', projectId);
    }
  }, [socket, connected, projectId]);

  // Timer to shift chart data every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' });
      
      const newDataPoint = {
        time: timeStr,
        requests: currentIntervalCounts.current.requests,
        threats: currentIntervalCounts.current.threats,
      };

      // Reset counters for next interval
      currentIntervalCounts.current = { requests: 0, threats: 0 };

      // Shift old data and push new
      const newChartData = [...chartDataRef.current.slice(1), newDataPoint];
      chartDataRef.current = newChartData;
      setChartData(newChartData);

    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleConnect = () => {
    if (socket && projectId) {
      socket.emit('join-project', projectId);
    }
  };

  const createProject = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/projects/create-project`, {
        projectName: newProjectName,
        description: newProjectDesc
      }, { withCredentials: true });
      if (res.data.success) {
        setProjectId(res.data.data._id);
        setShowProjectModal(false);
        setProjects(prev => [...prev, res.data.data]);
        setNewProjectName('');
        setNewProjectDesc('');
      }
    } catch (error) {
      alert('Error creating project: ' + (error.response?.data?.message || error.message));
    }
  };

  const generateApiKey = async () => {
    if (!projectId) {
      alert('Please select or create a project first.');
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/apikey/create-new-apikey`, {
        projectId
      }, { withCredentials: true });
      if (res.data.success) {
        setApiKeyResult(res.data.data.key);
      }
    } catch (error) {
      alert('Error generating API key: ' + (error.response?.data?.message || error.message));
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      {/* Sidebar background gradient effect */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[30%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <Sidebar />
      
      <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
        <TopNav 
          connected={connected} 
          projectId={projectId} 
          setProjectId={setProjectId}
          projects={projects}
          onConnect={handleConnect}
        />
        
        <main className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="mx-auto max-w-7xl space-y-6">
            
            {/* Header info */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-50">Overview</h2>
                <p className="text-gray-400 mt-1">
                  Real-time security analytics for project{' '}
                  <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-400">
                    {projectId || 'None Selected'}
                  </code>
                </p>
              </div>
              <div className="flex space-x-3">
                <button 
                  onClick={() => setShowProjectModal(true)}
                  className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition"
                >
                  + New Project
                </button>
                <button 
                  onClick={generateApiKey}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm font-medium transition"
                >
                  Generate API Key
                </button>
              </div>
            </div>

            {apiKeyResult && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-md flex justify-between items-center">
                <span>
                  <strong>New API Key:</strong> {apiKeyResult}
                </span>
                <button onClick={() => setApiKeyResult('')} className="text-green-500 hover:text-green-300">
                  Dismiss
                </button>
              </div>
            )}

            {/* Project Modal */}
            {showProjectModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Create New Project</h3>
                  <form onSubmit={createProject} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Project Name</label>
                      <input 
                        required
                        type="text" 
                        value={newProjectName}
                        onChange={e => setNewProjectName(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-blue-500 outline-none" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                      <input 
                        type="text" 
                        value={newProjectDesc}
                        onChange={e => setNewProjectDesc(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-blue-500 outline-none" 
                      />
                    </div>
                    <div className="flex justify-end space-x-3 pt-2">
                      <button 
                        type="button" 
                        onClick={() => setShowProjectModal(false)}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium"
                      >
                        Create
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard 
                title="Total API Requests" 
                value={metrics.totalRequests.toLocaleString()} 
                icon={<Activity size={24} />} 
                trend="12%" trendUp={true} 
              />
              <MetricCard 
                title="Threats Blocked" 
                value={metrics.threatsBlocked.toLocaleString()} 
                icon={<ShieldOff size={24} />} 
                trend="8%" trendUp={false} 
              />
              <MetricCard 
                title="Rate Limits Hit" 
                value={metrics.rateLimited.toLocaleString()} 
                icon={<AlertOctagon size={24} />} 
                trend="3%" trendUp={false} 
              />
              <MetricCard 
                title="Active Sessions" 
                value={metrics.activeSessions.toLocaleString()} 
                icon={<Cpu size={24} />} 
                trend="2%" trendUp={true} 
              />
            </div>

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
              <ActivityChart data={chartData} />
              <LogsTable logs={logs} />
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
