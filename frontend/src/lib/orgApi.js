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
};

export const ROLE_OPTIONS = ['owner', 'admin', 'security-analyst', 'developer', 'read-only', 'billing'];
