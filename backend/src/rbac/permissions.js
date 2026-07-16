import { ROLES } from "./roles.js"

// Permission matrix (doc 04 §Cap2) — the single source of truth for "which role
// may do what". Config, not code: each built-in role maps to a set of
// `resource:action` tokens. Wildcards are allowed — `resource:*` (all actions on
// a resource) and `*:*` (everything). Resolution (Phase 3.2 engine) unions these
// across a user's grants; it never collapses to one "winning" role.
//
// Resources: org, team, project, environment, apikey, member, rule, analytics,
//            threat, billing.
// Actions:   read, create, update, delete.

const ALL_READ = [
    "org:read", "team:read", "project:read", "environment:read",
    "apikey:read", "member:read", "rule:read", "analytics:read", "threat:read",
]

export const ROLE_PERMISSIONS = Object.freeze({
    // Full control, including org lifecycle + billing.
    owner: new Set(["*:*"]),

    // Everything operational; NOT billing, NOT org create/delete.
    admin: new Set([
        "org:read", "org:update",
        "team:*", "project:*", "environment:*", "apikey:*",
        "member:*", "rule:*",
        "analytics:read", "threat:*",
    ]),

    // Reads the platform; owns threat + detection-rule tuning. No member mgmt,
    // no project/team/key lifecycle, no billing.
    "security-analyst": new Set([
        ...ALL_READ,
        "rule:*", "threat:*",
    ]),

    // Builds: manage projects/environments/keys/rules; read analytics/threats.
    // No member mgmt, no team lifecycle, no billing.
    developer: new Set([
        "org:read", "team:read",
        "project:*", "environment:*", "apikey:*", "rule:*",
        "analytics:read", "threat:read",
    ]),

    // Sees everything in scope, changes nothing.
    "read-only": new Set(ALL_READ),

    // Billing/plan only (+ read the org it applies to).
    billing: new Set(["org:read", "billing:*"]),
})

// Fail loud if roles.js and the matrix ever drift.
for (const r of ROLES) {
    if (!ROLE_PERMISSIONS[r]) throw new Error(`RBAC matrix missing permissions for role "${r}"`)
}

// Does a single role's permission set allow resource:action? Honors wildcards.
export function roleAllows(role, resource, action) {
    const set = ROLE_PERMISSIONS[role]
    if (!set) return false
    return set.has("*:*") ||
        set.has(`${resource}:*`) ||
        set.has(`${resource}:${action}`)
}
