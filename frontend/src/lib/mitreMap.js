// Phase 3.11 (Dashboard V2) — static threat-status → ATT&CK/OWASP mapping.
//
// The detector signals ARE tagged with owasp/mitre at emit time (see
// detectors.middleware.js + decision.middleware.js), but those tags aren't
// persisted on APIUsage (no schema change wanted). Since the mapping is
// deterministic per status, we mirror it here so the MITRE view can group the
// dashboard's byStatus counts into an ATT&CK-style board with zero backend cost.
//
// Tags mirror the backend where a detector emits them; the Phase-1 auth statuses
// (failed/locked/session-theft/bot) are mapped to their conventional techniques.
export const MITRE_MAP = {
  reputation:          { tactic: 'Reconnaissance',    technique: 'Active Scanning',                     mitre: 'T1595',     owasp: 'API#—' },
  bot:                 { tactic: 'Reconnaissance',    technique: 'Active Scanning (Automated)',         mitre: 'T1595',     owasp: 'API#4' },
  sqli:                { tactic: 'Initial Access',     technique: 'Exploit Public-Facing App',           mitre: 'T1190',     owasp: 'API#8' },
  nosqli:              { tactic: 'Initial Access',     technique: 'Exploit Public-Facing App',           mitre: 'T1190',     owasp: 'API#8' },
  ssrf:                { tactic: 'Initial Access',     technique: 'Exploit Public-Facing App',           mitre: 'T1190',     owasp: 'API#7' },
  'impossible-travel': { tactic: 'Initial Access',     technique: 'Valid Accounts',                      mitre: 'T1078',     owasp: 'API#2' },
  xss:                 { tactic: 'Execution',          technique: 'Command & Scripting Interpreter',     mitre: 'T1059',     owasp: 'API#3' },
  'prompt-injection':  { tactic: 'ML Attack (ATLAS)',  technique: 'LLM Prompt Injection',                mitre: 'AML.T0051', owasp: 'LLM#1' },
  failed:              { tactic: 'Credential Access',  technique: 'Brute Force',                         mitre: 'T1110',     owasp: 'API#2' },
  locked:              { tactic: 'Credential Access',  technique: 'Brute Force',                         mitre: 'T1110',     owasp: 'API#2' },
  'session-theft':     { tactic: 'Credential Access',  technique: 'Steal Web Session Cookie',            mitre: 'T1539',     owasp: 'API#2' },
  'jwt-abuse':         { tactic: 'Lateral Movement',   technique: 'Use Alternate Authentication Material', mitre: 'T1550',   owasp: 'API#2' },
  blocked:             { tactic: 'Impact',             technique: 'Policy Block',                        mitre: '—',         owasp: '—' },
};

// Kill-chain order for laying out the board left→right.
export const TACTIC_ORDER = [
  'Reconnaissance',
  'Initial Access',
  'Execution',
  'Credential Access',
  'Lateral Movement',
  'ML Attack (ATLAS)',
  'Impact',
];

// Group a byStatus count map into [{ tactic, techniques:[{status,technique,mitre,owasp,count}], total }]
// ordered by TACTIC_ORDER. Non-threat/unmapped statuses (success, rate-limited)
// are skipped.
export function groupByTactic(byStatus = {}) {
  const tactics = new Map();
  for (const [status, count] of Object.entries(byStatus)) {
    const def = MITRE_MAP[status];
    if (!def || !count) continue;
    if (!tactics.has(def.tactic)) tactics.set(def.tactic, { tactic: def.tactic, techniques: [], total: 0 });
    const entry = tactics.get(def.tactic);
    entry.techniques.push({ status, technique: def.technique, mitre: def.mitre, owasp: def.owasp, count });
    entry.total += count;
  }
  return TACTIC_ORDER
    .filter((t) => tactics.has(t))
    .map((t) => {
      const e = tactics.get(t);
      e.techniques.sort((a, b) => b.count - a.count);
      return e;
    });
}
