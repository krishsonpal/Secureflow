import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    // Use username or email based on what the user types
    const isEmail = username.includes('@');
    const result = await login(isEmail ? '' : username, isEmail ? username : '', password);
    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 font-sans text-white">
      <Card className="w-full max-w-md bg-gray-900/80 backdrop-blur-xl border-blue-500/30 shadow-2xl overflow-hidden p-2 text-white">
        <CardHeader className="text-center pb-6 border-b border-gray-800">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-500/10 p-4 rounded-full border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
              <Shield size={48} className="text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight mb-2">Secure<span className="text-blue-500">Flow</span></CardTitle>
          <CardDescription className="text-gray-400">
            Pluggable API Security & Threat Detection System
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <form onSubmit={handleLogin} className="space-y-5">
            {error && <div className="text-red-500 text-sm font-medium">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Username or Email</Label>
              <Input 
                id="username"
                type="text" 
                className="bg-black/40 border-gray-800 focus-visible:ring-blue-500 h-12 text-md transition-all focus:bg-black/60 text-white" 
                placeholder="admin@secureflow.dev"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Password</Label>
              <Input 
                id="password"
                type="password" 
                className="bg-black/40 border-gray-800 focus-visible:ring-blue-500 h-12 text-md transition-all focus:bg-black/60 text-white" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold h-12 mt-4 text-md shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.6)] transition-all">
              Access System
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex justify-center border-t border-gray-800 pt-6 pb-2 text-sm text-gray-400">
          <p>Don't have clearance? <Link to="/register" className="text-blue-500 hover:text-blue-400 font-medium hover:underline transition-colors">Request Access</Link></p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Login;
