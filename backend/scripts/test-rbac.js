// Phase 3.2 — RBAC engine unit tests (pure, no DB). Run: node scripts/test-rbac.js
import { hasPermission, effectivePermissions, membershipCoversTarget, permissionSetAllows } from "../src/rbac/hasPermission.js"
import { roleAllows } from "../src/rbac/permissions.js"

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++ } else { fail++; console.error("  ✗", msg) } }

// Stable fake ids.
const O = "org1", O2 = "org2", TA = "teamA", TB = "teamB", P1 = "proj1", P2 = "proj2"
const g = (role, scopeType, extra = {}) => ({ organizationId: O, scopeType, role, teamId: null, projectId: null, ...extra })

const projTarget = { organizationId: O, teamId: TA, projectId: P1 }
const orgTarget = { organizationId: O }

// --- matrix / wildcards -----------------------------------------------------
ok(roleAllows("owner", "billing", "delete"), "owner *:* covers billing:delete")
ok(roleAllows("admin", "project", "delete"), "admin project:* covers project:delete")
ok(!roleAllows("admin", "billing", "read"), "admin has NO billing")
ok(!roleAllows("developer", "member", "create"), "developer cannot manage members")
ok(!roleAllows("read-only", "project", "update"), "read-only cannot mutate")
ok(roleAllows("read-only", "analytics", "read"), "read-only can read analytics")
ok(roleAllows("security-analyst", "rule", "update"), "analyst tunes rules")
ok(!roleAllows("security-analyst", "member", "create"), "analyst cannot invite members")
ok(roleAllows("billing", "billing", "update") && !roleAllows("billing", "project", "read"), "billing role is billing-only (+org:read)")

// alert resource (Phase 3.6)
ok(roleAllows("security-analyst", "alert", "create") && roleAllows("security-analyst", "alert", "delete"), "analyst has alert:*")
ok(roleAllows("admin", "alert", "update"), "admin has alert:*")
ok(roleAllows("developer", "alert", "read") && !roleAllows("developer", "alert", "create"), "developer alert:read only")
ok(roleAllows("read-only", "alert", "read") && !roleAllows("read-only", "alert", "update"), "read-only alert:read only")

// --- scope coverage ---------------------------------------------------------
ok(membershipCoversTarget(g("admin", "org"), projTarget), "org grant covers a project target")
ok(membershipCoversTarget(g("admin", "team", { teamId: TA }), projTarget), "team grant covers project in that team")
ok(!membershipCoversTarget(g("admin", "team", { teamId: TB }), projTarget), "team grant does NOT cover other team's project")
ok(membershipCoversTarget(g("developer", "project", { teamId: TA, projectId: P1 }), projTarget), "project grant covers that project")
ok(!membershipCoversTarget(g("developer", "project", { teamId: TA, projectId: P2 }), projTarget), "project grant does NOT cover another project")
ok(!membershipCoversTarget({ ...g("owner", "org"), organizationId: O2 }, projTarget), "grant in another org never covers")

// --- additive union (the decided model) -------------------------------------
// Org:Developer + Project:ReadOnly ⇒ still developer perms on that project (narrower can't subtract).
const m1 = [g("developer", "org"), g("read-only", "project", { teamId: TA, projectId: P1 })]
ok(hasPermission(m1, "project", "update", projTarget), "additive: org-developer keeps project:update despite project read-only grant")

// Org:Developer + ProjectB:Admin ⇒ admin perms on B, developer perms on A.
const m2 = [g("developer", "org"), g("admin", "project", { teamId: TB, projectId: P2 })]
ok(!hasPermission(m2, "member", "create", { organizationId: O, teamId: TA, projectId: P1 }), "developer alone can't manage members on project A")
ok(hasPermission(m2, "member", "create", { organizationId: O, teamId: TB, projectId: P2 }), "admin grant on project B allows member mgmt there")

// --- deny by default --------------------------------------------------------
ok(!hasPermission([], "project", "read", projTarget), "no memberships ⇒ deny")
ok(!hasPermission([{ ...g("owner", "org"), organizationId: O2 }], "project", "read", projTarget), "owner of a DIFFERENT org ⇒ deny (isolation)")

// --- effectivePermissions primitive ----------------------------------------
const perms = effectivePermissions([g("security-analyst", "org")], orgTarget)
ok(permissionSetAllows(perms, "threat", "update") && !permissionSetAllows(perms, "member", "create"),
    "effectivePermissions reflects analyst set (threat yes, member no)")

console.log(`\nRBAC tests: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
