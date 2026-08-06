import { ROLE_PERMISSIONS, roleAllows } from "./permissions.js"

// Pure RBAC resolution engine (no DB, no HTTP — trivially unit-testable).
//
// Model: permissions are ADDITIVE. A user's ability at a target is the UNION of
// the permission sets of every grant whose scope COVERS the target. A narrower
// grant can only add; it never subtracts (deny grants are a deferred Enterprise
// feature). There is deliberately no `effectiveRole()` — we combine permissions,
// not pick a single winning role.
//
// A `target` is where the resource lives: { organizationId, teamId?, projectId? }.
// A `membership` grant is { organizationId, scopeType, teamId?, projectId?, role }.

const eq = (a, b) => a != null && b != null && String(a) === String(b)

// Does this grant's scope reach the target?
//  - org     grant → any target in the same org
//  - team    grant → targets in that team (incl. projects under it)
//  - project grant → only that exact project
export function membershipCoversTarget(m, target) {
    if (!eq(m.organizationId, target.organizationId)) return false
    if (m.scopeType === "org") return true
    if (m.scopeType === "team") return eq(m.teamId, target.teamId)
    if (m.scopeType === "project") return eq(m.projectId, target.projectId)
    return false
}

// The additive union of permission tokens (may contain wildcards like "rule:*")
// from every grant that covers the target. This is the primitive; hasPermission
// is a membership test against it.
export function effectivePermissions(memberships, target) {
    const out = new Set()
    for (const m of memberships || []) {
        if (!membershipCoversTarget(m, target)) continue
        const set = ROLE_PERMISSIONS[m.role]
        if (set) for (const p of set) out.add(p)
    }
    return out
}

// Does a resolved permission set allow resource:action? Honors wildcards.
export function permissionSetAllows(perms, resource, action) {
    return perms.has("*:*") || perms.has(`${resource}:*`) || perms.has(`${resource}:${action}`)
}

// hasPermission(...) === "{resource}:{action}" is granted by effectivePermissions.
// Short-circuits per-grant so a huge membership list stays cheap.
export function hasPermission(memberships, resource, action, target) {
    for (const m of memberships || []) {
        if (membershipCoversTarget(m, target) && roleAllows(m.role, resource, action)) return true
    }
    return false
}
