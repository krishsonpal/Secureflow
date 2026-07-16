// Shared RBAC vocabulary. Kept in one place so the Membership model, the
// permission matrix (Phase 3.2), and the management API all agree on the exact
// role/scope strings. Full permission matrix + resolution live in Phase 3.2;
// this file is intentionally just the enums so 3.1 can reference them.

// Built-in roles (doc 04 §Cap2). Kebab-case to match the app's other enums
// (e.g. APIUsage statuses like "prompt-injection"). Custom roles are Enterprise
// (deferred) — this list is closed for now.
export const ROLES = Object.freeze([
    "owner",            // full control incl. org deletion + billing
    "admin",            // manage teams/projects/members, not billing/org-delete
    "security-analyst", // read + act on threats/rules; no member management
    "developer",        // manage own projects/keys; read analytics
    "read-only",        // read everything in scope, mutate nothing
    "billing",          // billing/plan only
])

// A grant applies at exactly one scope level. Narrower scopes ADD permissions
// on that resource (additive union — see Phase 3.2); they never subtract.
export const SCOPE_TYPES = Object.freeze(["org", "team", "project"])

export const isRole = (r) => ROLES.includes(r)
export const isScopeType = (s) => SCOPE_TYPES.includes(s)
