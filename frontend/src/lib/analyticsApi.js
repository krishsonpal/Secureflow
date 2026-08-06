import axios from 'axios';

// Phase 3.11 (Dashboard V2) — thin client for the project analytics endpoints
// (project.controller + analytics.controller). Mirrors orgApi's style: auth rides
// on httpOnly cookies (withCredentials); each call returns the APIResponse `data`
// payload or throws with the server's message. Consolidates the analytics axios
// wiring that was duplicated across Dashboard / LiveTraffic / ThreatAnalysis.
const API_URL = import.meta.env.VITE_API_URL ||
  `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/v1`;

const cfg = { withCredentials: true };
const unwrap = (res) => res.data?.data;
const fail = (e) => { throw new Error(e.response?.data?.message || e.message || 'Request failed'); };

export const analyticsApi = {
  listProjects: () => axios.get(`${API_URL}/projects/my-projects`, cfg).then(unwrap).catch(fail),
  getAnalytics: (projectId) => axios.get(`${API_URL}/projects/${projectId}/analytics`, cfg).then(unwrap).catch(fail),
  getTimeseries: (projectId, params = {}) => axios.get(`${API_URL}/projects/${projectId}/timeseries`, { ...cfg, params }).then(unwrap).catch(fail),
  // Threat Explorer search — params: status, action, riskMin, riskMax, from, to,
  // fingerprint, ip, q, limit, before. Returns { events, nextBefore }.
  searchEvents: (projectId, params = {}) => axios.get(`${API_URL}/projects/${projectId}/events`, { ...cfg, params }).then(unwrap).catch(fail),
  // Attack Map origins — params: { hours }. Returns { hours, breakdown:[{country,count}] }.
  getGeo: (projectId, params = {}) => axios.get(`${API_URL}/projects/${projectId}/geo`, { ...cfg, params }).then(unwrap).catch(fail),
};

// Threat statuses (mirror of backend THREAT_STATUSES) — reused by the Threat
// Explorer filter chips and the Dashboard taxonomy. Kept alongside orgApi's copy;
// re-exported here so analytics surfaces import one module.
export const THREAT_STATUS_OPTIONS = [
  'failed', 'locked', 'xss', 'session-theft', 'bot', 'blocked',
  'sqli', 'nosqli', 'ssrf', 'jwt-abuse', 'prompt-injection', 'reputation', 'impossible-travel',
];
