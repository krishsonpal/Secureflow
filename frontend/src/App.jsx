import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Docs from './pages/Docs';
import Login from './pages/Login';
import Register from './pages/Register';
import LiveTraffic from './pages/LiveTraffic';
import ThreatAnalysis from './pages/ThreatAnalysis';
import ThreatExplorer from './pages/ThreatExplorer';
import Settings from './pages/Settings';
import Organization from './pages/Organization';
import AcceptInvite from './pages/AcceptInvite';
import Alerts from './pages/Alerts';
import { AuthProvider, useAuth } from './context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return <Navigate to="/login" />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/docs"
        element={
          <ProtectedRoute>
            <Docs />
          </ProtectedRoute>
        }
      />
      <Route path="/live-traffic" element={<ProtectedRoute><LiveTraffic /></ProtectedRoute>} />
      <Route path="/threat-analysis" element={<ProtectedRoute><ThreatAnalysis /></ProtectedRoute>} />
      <Route path="/threat-explorer" element={<ProtectedRoute><ThreatExplorer /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/organization" element={<ProtectedRoute><Organization /></ProtectedRoute>} />
      <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
      <Route path="/invite" element={<ProtectedRoute><AcceptInvite /></ProtectedRoute>} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
