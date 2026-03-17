import React from 'react';
import { LayoutDashboard, Shield, Activity, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Sidebar = () => {
  const { logout } = useAuth();
  
  return (
    <div className="flex h-screen w-64 flex-col bg-gray-900/40 border-r border-gray-800 backdrop-blur-md">
      <div className="flex h-16 items-center px-6 border-b border-gray-800">
        <Shield className="h-6 w-6 text-blue-500 mr-2" />
        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
          SecureFlow
        </span>
      </div>
      <nav className="flex-1 space-y-2 px-4 py-6">
        <NavItem icon={<LayoutDashboard size={20} />} label="Dashboard" active />
        <NavItem icon={<Activity size={20} />} label="Live Traffic" />
        <NavItem icon={<Shield size={20} />} label="Threat Analysis" />
        <NavItem icon={<Settings size={20} />} label="Settings" />
      </nav>
      <div className="p-4 border-t border-gray-800">
        <div onClick={logout}>
          <NavItem icon={<LogOut size={20} />} label="Logout" />
        </div>
      </div>
    </div>
  );
};

const NavItem = ({ icon, label, active }) => {
  return (
    <div
      className={`flex items-center cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-500/10 text-blue-400'
          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-50'
      }`}
    >
      <span className="mr-3">{icon}</span>
      {label}
    </div>
  );
};

export default Sidebar;
