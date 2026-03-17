import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Register = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await register(username, email, password);
    setLoading(false);
    if (result.success) {
      navigate('/login');
    } else {
      setError(result?.error || 'Registration failed');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 font-sans text-white">
      <Card className="w-full max-w-md bg-gray-900/80 backdrop-blur-xl border-indigo-500/30 shadow-2xl overflow-hidden p-2 text-white">
        <CardHeader className="text-center pb-6 border-b border-gray-800">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-500/10 p-4 rounded-full border border-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
              <ShieldAlert size={48} className="text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight mb-2">Request <span className="text-indigo-500">Clearance</span></CardTitle>
          <CardDescription className="text-gray-400">
            Join the SecureFlow Defense Network
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <form onSubmit={handleRegister} className="space-y-4">
            {error && <div className="text-red-500 text-sm font-medium">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Username</Label>
              <Input 
                id="username"
                type="text" 
                className="bg-black/40 border-gray-800 focus-visible:ring-indigo-500 h-12 text-md transition-all focus:bg-black/60 text-white" 
                placeholder="johndoe"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Email Address</Label>
              <Input 
                id="email"
                type="email" 
                className="bg-black/40 border-gray-800 focus-visible:ring-indigo-500 h-12 text-md transition-all focus:bg-black/60 text-white" 
                placeholder="admin@secureflow.dev"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Password</Label>
              <Input 
                id="password"
                type="password" 
                className="bg-black/40 border-gray-800 focus-visible:ring-indigo-500 h-12 text-md transition-all focus:bg-black/60 text-white" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <Button disabled={loading} type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold h-12 mt-6 text-md shadow-[0_0_15px_rgba(99,102,241,0.4)] hover:shadow-[0_0_25px_rgba(99,102,241,0.6)] transition-all">
              Initialize Credentials
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex justify-center border-t border-gray-800 pt-6 pb-2 text-sm text-gray-400">
          <p>Already have clearance? <Link to="/login" className="text-indigo-500 hover:text-indigo-400 font-medium hover:underline transition-colors">Login</Link></p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Register;
