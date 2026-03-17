
import { Bell, Search, User, ChevronDown } from 'lucide-react';

const TopNav = ({ connected, projectId, setProjectId, projects = [], onConnect }) => {
  return ( 
    <header className="flex h-16 items-center justify-between border-b border-gray-800 bg-gray-900/20 px-6 backdrop-blur-md">
      <div className="flex w-1/3 items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search API keys or threats..."
            className="w-full rounded-md border border-gray-800 bg-gray-950 px-9 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-3 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-red-500'}`} />
          <span className="text-xs font-semibold text-gray-300">
            {connected ? 'Real-time Active' : 'Disconnected'}
          </span>
          <div className="h-4 w-[1px] bg-gray-700 mx-2" />
          <div className="relative flex items-center">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-36 appearance-none bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none pr-6 cursor-pointer"
            >
              <option value="" disabled className="bg-gray-900">Select Project...</option>
              {projects.map(p => (
                <option key={p._id} value={p._id} className="bg-gray-900">
                  {p.projectName}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-0 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
          <button 
            onClick={onConnect}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
          >
            Join
          </button>
        </div>

        <button className="relative text-gray-400 hover:text-gray-100">
          <Bell className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">
            3
          </span>
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-gray-100 hover:bg-gray-700">
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};

export default TopNav;
