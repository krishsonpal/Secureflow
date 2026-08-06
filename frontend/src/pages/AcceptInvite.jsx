import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { orgApi } from '../lib/orgApi';
import { MailCheck } from 'lucide-react';

// /invite?token=... — a logged-in user redeems an org invitation. Protected
// route, so the user is already authenticated; the server checks the token's
// email matches. On success we route to the Organization page.
const AcceptInvite = () => {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [state, setState] = useState('idle'); // idle | working | ok | error
  const [msg, setMsg] = useState('');

  const accept = async () => {
    setState('working');
    try {
      await orgApi.acceptInvite(token);
      setState('ok');
      setTimeout(() => navigate('/organization'), 1200);
    } catch (e) { setMsg(e.message); setState('error'); }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-950 text-white font-sans">
      <div className="w-full max-w-md rounded-xl bg-gray-900/60 border border-gray-800 p-8 text-center space-y-4">
        <MailCheck className="mx-auto text-blue-500" size={40} />
        <h1 className="text-xl font-bold">Accept organization invite</h1>
        {!token && <p className="text-red-400 text-sm">Missing invite token.</p>}
        {token && state === 'idle' && (
          <>
            <p className="text-gray-400 text-sm">You’re about to join an organization on SecureFlow. This uses your signed-in account.</p>
            <button onClick={accept} className="w-full bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium">Accept invitation</button>
          </>
        )}
        {state === 'working' && <p className="text-gray-400 text-sm">Accepting…</p>}
        {state === 'ok' && <p className="text-green-400 text-sm">Joined! Redirecting…</p>}
        {state === 'error' && (
          <>
            <p className="text-red-400 text-sm">{msg}</p>
            <button onClick={() => navigate('/organization')} className="text-gray-400 text-sm hover:text-gray-200">Go to Organization</button>
          </>
        )}
      </div>
    </div>
  );
};

export default AcceptInvite;
