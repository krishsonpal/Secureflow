import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.jsx';
import { ShieldAlert, CheckCircle2, AlertTriangle, Fingerprint, Ghost, Bug, UserX } from 'lucide-react';

const LogsTable = ({ logs }) => {
  const getStatusConfig = (status) => {
    switch (status) {
      case 'success':
        return { color: 'text-green-500', bg: 'bg-green-500/10', icon: <CheckCircle2 size={16} className="mr-2" /> };
      case 'xss':
        return { color: 'text-rose-500', bg: 'bg-rose-500/10', icon: <Bug size={16} className="mr-2" /> };
      case 'session-theft':
        return { color: 'text-fuchsia-500', bg: 'bg-fuchsia-500/10', icon: <UserX size={16} className="mr-2" /> };
      case 'bot':
        return { color: 'text-orange-500', bg: 'bg-orange-500/10', icon: <Ghost size={16} className="mr-2" /> };
      case 'failed':
      case 'locked':
        return { color: 'text-red-500', bg: 'bg-red-500/10', icon: <ShieldAlert size={16} className="mr-2" /> };
      case 'rate-limited':
        return { color: 'text-yellow-500', bg: 'bg-yellow-500/10', icon: <AlertTriangle size={16} className="mr-2" /> };
      default:
        return { color: 'text-gray-500', bg: 'bg-gray-500/10', icon: null };
    }
  };

  return (
    <Card className="col-span-3 h-full overflow-hidden flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-800">
        <CardTitle>Live Security Logs</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-0">
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-gray-500 p-8">
            <Fingerprint size={48} className="mb-4 opacity-20" />
            <p className="text-sm">No live traffic detected yet.</p>
            <p className="text-xs mt-1">Waiting for incoming requests...</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {logs.map((log) => {
              const config = getStatusConfig(log.status);
              return (
                <div key={log.id} className="flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center space-x-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-200 font-mono">
                        {log.fingerprint || 'Unknown Device'}
                      </span>
                      {log.message && (
                        <span className="text-xs text-gray-400 mt-0.5">
                          {log.message}
                        </span>
                      )}
                      <span className="text-xs text-gray-500 mt-0.5">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className={`flex items-center rounded-full px-3 py-1 text-xs font-semibold ${config.bg} ${config.color}`}>
                    {config.icon}
                    {log.status.toUpperCase()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LogsTable;
