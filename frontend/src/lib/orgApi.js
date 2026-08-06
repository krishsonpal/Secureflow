import axios from 'axios';

// Phase 3.5 — thin client for the org/team/member/environment management API
// (Phase 3.4). Auth rides on httpOnly cookies (withCredentials, set globally in
// AuthContext). Each call returns the APIResponse `data` payload or throws with
// the server's message.
const API_URL = import.meta.env.VITE_API_URL ||
  `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/v1`;

const cfg = { withCredentials: true };
const unwrap = (res) => res.data?.data;
const fail = (e) => { throw new Error(e.response?.data?.message || e.message || 'Request failed'); };

export const orgApi = {
  // Orgs
  listMyOrgs: () => axios.get(`${API_URL}/orgs`, cfg).then(unwrap).catch(fail),
  createOrg: (name) => axios.post(`${API_URL}/orgs`, { name }, cfg).then(unwrap).catch(fail),
  updateOrg: (orgId, name) => axios.patch(`${API_URL}/orgs/${orgId}`, { name }, cfg).then(unwrap).catch(fail),

  // Members
  listMembers: (orgId) => axios.get(`${API_URL}/orgs/${orgId}/members`, cfg).then(unwrap).catch(fail),
  invite: (orgId, email, role) => axios.post(`${API_URL}/orgs/${orgId}/members/invite`, { email, role }, cfg).then(unwrap).catch(fail),
  changeRole: (orgId, userId, role) => axios.patch(`${API_URL}/orgs/${orgId}/members/${userId}`, { role, scopeType: 'org' }, cfg).then(unwrap).catch(fail),
  removeMember: (orgId, userId) => axios.delete(`${API_URL}/orgs/${orgId}/members/${userId}`, cfg).then(unwrap).catch(fail),
  acceptInvite: (token) => axios.post(`${API_URL}/orgs/invites/accept`, { token }, cfg).then(unwrap).catch(fail),

  // Teams
  listTeams: (orgId) => axios.get(`${API_URL}/orgs/${orgId}/teams`, cfg).then(unwrap).catch(fail),
  createTeam: (orgId, name) => axios.post(`${API_URL}/orgs/${orgId}/teams`, { name }, cfg).then(unwrap).catch(fail),

  // Projects / environments / keys
  listProjects: () => axios.get(`${API_URL}/projects/my-projects`, cfg).then(unwrap).catch(fail),
  listEnvironments: (projectId) => axios.get(`${API_URL}/projects/${projectId}/environments`, cfg).then(unwrap).catch(fail),
  createEnvironment: (projectId, name) => axios.post(`${API_URL}/projects/${projectId}/environments`, { name }, cfg).then(unwrap).catch(fail),
  createApiKey: (projectId, environmentId) => axios.post(`${API_URL}/apikey/create-new-apikey`, { projectId, environmentId }, cfg).then(unwrap).catch(fail),

  // Alerting (Phase 3.9) — all org-scoped.
  listAlerts: (orgId, params = {}) => axios.get(`${API_URL}/orgs/${orgId}/alerts`, { ...cfg, params }).then(unwrap).catch(fail),
  ackAlert: (orgId, alertId) => axios.patch(`${API_URL}/orgs/${orgId}/alerts/${alertId}/ack`, {}, cfg).then(unwrap).catch(fail),
  resolveAlert: (orgId, alertId) => axios.patch(`${API_URL}/orgs/${orgId}/alerts/${alertId}/resolve`, {}, cfg).then(unwrap).catch(fail),

  listAlertChannels: (orgId) => axios.get(`${API_URL}/orgs/${orgId}/alert-channels`, cfg).then(unwrap).catch(fail),
  createAlertChannel: (orgId, body) => axios.post(`${API_URL}/orgs/${orgId}/alert-channels`, body, cfg).then(unwrap).catch(fail),
  deleteAlertChannel: (orgId, id) => axios.delete(`${API_URL}/orgs/${orgId}/alert-channels/${id}`, cfg).then(unwrap).catch(fail),
  testAlertChannel: (orgId, id) => axios.post(`${API_URL}/orgs/${orgId}/alert-channels/${id}/test`, {}, cfg).then(unwrap).catch(fail),

  listAlertRules: (orgId) => axios.get(`${API_URL}/orgs/${orgId}/alert-rules`, cfg).then(unwrap).catch(fail),
  createAlertRule: (orgId, body) => axios.post(`${API_URL}/orgs/${orgId}/alert-rules`, body, cfg).then(unwrap).catch(fail),
  updateAlertRule: (orgId, id, body) => axios.patch(`${API_URL}/orgs/${orgId}/alert-rules/${id}`, body, cfg).then(unwrap).catch(fail),
  deleteAlertRule: (orgId, id) => axios.delete(`${API_URL}/orgs/${orgId}/alert-rules/${id}`, cfg).then(unwrap).catch(fail),
};

export const ROLE_OPTIONS = ['owner', 'admin', 'security-analyst', 'developer', 'read-only', 'billing'];

// Threat statuses an alert rule can match on (mirror of backend THREAT_STATUSES).
export const THREAT_STATUS_OPTIONS = [
  'failed', 'locked', 'xss', 'session-theft', 'bot', 'blocked',
  'sqli', 'nosqli', 'ssrf', 'jwt-abuse', 'prompt-injection', 'reputation', 'impossible-travel',
];
