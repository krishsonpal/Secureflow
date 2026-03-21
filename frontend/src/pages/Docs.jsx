import React from 'react';
import Sidebar from '../components/Sidebar';
import { Book } from 'lucide-react';

const Docs = () => {
  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden font-sans">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[30%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <Sidebar />
      
      <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
        <header className="flex h-16 items-center px-6 border-b border-gray-800 bg-gray-900/20 backdrop-blur-md">
          <Book className="h-5 w-5 text-blue-400 mr-3" />
          <h1 className="text-lg font-semibold text-gray-100">Documentation</h1>
        </header>
        
        <main className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <div className="mx-auto max-w-4xl space-y-8 pb-12">
            
            {/* Header */}
            <div className="space-y-4 border-b border-gray-800 pb-6">
              <h1 className="text-4xl font-bold tracking-tight text-white">SecureFlow Node.js SDK</h1>
              <p className="text-lg text-gray-400">
                The official Node.js Express SDK for integrating <strong>SecureFlow</strong> - Your Pluggable API Security & Threat Detection System.
              </p>
              <p className="text-gray-400">
                Protect your APIs with automated Session Theft detection, Rate Limiting, Brute Force protection, and XSS filtering with a simple plug-and-play middleware.
              </p>
            </div>

            {/* Installation */}
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Installation</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-blue-400">
                npm install secureflow-node
              </div>
            </div>

            {/* Initialization */}
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Initialization</h2>
              <p className="text-gray-400">Import and initialize the SDK with your Project API Key.</p>
              <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`const SecureFlow = require('secureflow-node');

const secureflow = new SecureFlow({
    apiKey: 'YOUR_SECUREFLOW_API_KEY' 
});`}
              </pre>
            </div>

            <div className="space-y-6 pt-4 border-t border-gray-800">
              <h2 className="text-3xl font-bold text-white">API Usage Reference</h2>

              {/* Section 1 */}
              <div className="space-y-4">
                <h3 className="text-xl font-medium text-blue-400">1. Protecting Routes (Express Middleware)</h3>
                <p className="text-gray-400">
                  Protect any Express route by plugging in <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-200">secureflow.validate()</code>. The middleware automatically blocks requests if the attached Fingerprint triggers a Session-Theft mismatch, Rate Limit violation, or XSS attempt across your SecureFlow deployment.
                </p>
                <div className="bg-blue-900/20 border border-blue-900/50 rounded-md p-4 text-sm text-blue-200">
                  <strong>Note:</strong> While making requests to API must pass <code className="bg-blue-950 px-1 rounded text-blue-300">x-session-id</code> and <code className="bg-blue-950 px-1 rounded text-blue-300">x-fingerprint</code> in headers (or in <code className="bg-blue-950 px-1 rounded text-blue-300">req.cookies.sessionId</code>).
                </div>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`const express = require('express');
const app = express();

// Protect a sensitive route
app.get('/api/protected-data', secureflow.validate(), (req, res) => {
    res.json({ data: 'This is highly sensitive data!' });
});`}
                </pre>
              </div>

              {/* Section 2 */}
              <div className="space-y-4 mt-8">
                <h3 className="text-xl font-medium text-blue-400">2. Track Successful Logins (Session Binding)</h3>
                <p className="text-gray-400">
                  When a user successfully authenticates on your app, report the event to SecureFlow so it can map the device fingerprint to the new session ID.
                </p>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`app.post('/api/login', async (req, res) => {
    const { email, password, fingerprint } = req.body;
    
    // ... Verify password/credentials internally ...
    const sessionId = "a_unique_session_id_generated_by_you";

    try {
        await secureflow.registerLogin(sessionId, fingerprint, email);
        res.json({ success: true, sessionId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete login' });
    }
});`}
                </pre>
              </div>

              {/* Section 3 */}
              <div className="space-y-4 mt-8">
                <h3 className="text-xl font-medium text-blue-400">3. Track Failed Logins (Brute-Force & Bot Protection)</h3>
                <p className="text-gray-400">
                  If a user fails to login, notify SecureFlow to count the failed attempts for that specific device fingerprint. If the threshold is breached, the fingerprint will be locked globally in your application.
                </p>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`app.post('/api/login', async (req, res) => {
    const { email, password, fingerprint } = req.body;
    const isValid = verifyPassword(email, password); // Your logic
    
    if (!isValid) {
        try {
            await secureflow.reportLoginFailure(fingerprint);
            return res.status(401).json({ error: 'Invalid credentials' });
        } catch (error) {
            // Handled locking (e.g. Rate Limit / 423 Locked)
            return res.status(error.response?.status || 500).json({ 
                error: error.response?.data?.message || 'Security lock active' 
            });
        }
    }
});`}
                </pre>
              </div>

              {/* Section 4 */}
              <div className="space-y-4 mt-8">
                <h3 className="text-xl font-medium text-blue-400">4. Tracking Logout (Session Unbinding)</h3>
                <p className="text-gray-400">
                  Always notify SecureFlow when a user logs out. This invalidates the active <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-200">sessionId</code> tracking.
                </p>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`app.post('/api/logout', async (req, res) => {
    const sessionId = req.headers['x-session-id'];
    
    try {
      await secureflow.logout(sessionId);
      res.json({ success: true, message: 'Logged out' });
    } catch(err) {
      res.status(500).json({ success: false });
    }
});`}
                </pre>
              </div>

              {/* Section 5 - Frontend */}
              <div className="space-y-4 mt-12 pt-8 border-t border-gray-800">
                <h2 className="text-2xl font-bold text-white">Frontend Integration</h2>
                <h3 className="text-xl font-medium text-blue-400">Generating Device Fingerprint</h3>
                <p className="text-gray-400">
                  To trace requests accurately from the frontend, you must generate a strong device fingerprint using <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-200">@fingerprintjs/fingerprintjs</code> and send it in your requests.
                </p>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-blue-400">
                  npm install @fingerprintjs/fingerprintjs
                </div>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-300">
{`import FingerprintJS from "@fingerprintjs/fingerprintjs";

export const getFingerprint = async () => {
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  return result.visitorId;
};`}
                </pre>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

export default Docs;
