# Tenancy & RBAC (Phase 3.1–3.3)

How authorization and tenant isolation work in this backend, and the one
convention that keeps the isolation guarantee from eroding.

## The tenancy tree (strict, single-parent)

```
Organization (tenant boundary)
  └─ Team            (Project.teamId, required)
       └─ Project
            └─ Environment   (Environment.projectId, required)
                 └─ ApiKey    (ApiKey.environmentId)
```

Every management row carries `organizationId` — the tenant key everything
filters by. There is no multi-team project sharing (deferred); every org has one
`isDefault` Team so simple orgs never see teams.

## RBAC (`rbac/`)

- `roles.js` — built-in roles + scope-type vocabulary.
- `permissions.js` — the matrix: role → `resource:action` tokens (wildcards ok).
  Single source of truth for "who may do what".
- `hasPermission.js` — pure resolver. Permissions are **additive**: a user's
  ability at a target is the **union** of the permission sets of every grant
  (`Membership`) whose scope **covers** the target. A narrower grant only adds,
  never subtracts. There is no single "effective role".

A `Membership` grants a role at org / team / project scope. `org ⊇ team ⊇
project` coverage is encoded in `membershipCoversTarget`.

## Enforcement

- `middleware/authorize.js` — `authorize(resource, action)` after `verifyJWT`.
  Resolves the **resource's** tenant scope from the DB (so a cross-org id is
  caught here), caches it on `req.tenant`, loads the caller's grants in that org,
  and **fails closed** (no user / no org / no covering grant ⇒ 403; missing
  resource ⇒ 404).

- `utils/tenantScope.js` — `tenantRepo(req, Model)` and `tenantFilter(req, extra)`.

## CONVENTION — scope by construction

In management controllers, **query through `tenantRepo(req, Model)`**, not raw
`Model.find/.findOne/.updateOne/...`. `tenantRepo` injects `organizationId`
internally, so a new query is tenant-scoped for free and cannot leak across
tenants. Use `tenantFilter(req, extra)` only for hand-built aggregation `$match`
stages.

> Raw `Model.find(...)` in a management controller is a smell — it means the
> tenant filter is being applied by hand (easy to forget). Prefer the repo.

Optional lint guard (later enforcement) — flag direct tenant-model queries
outside the data-access layer, e.g. an ESLint `no-restricted-syntax` rule:

```jsonc
// .eslintrc — illustrative; not yet wired
"no-restricted-syntax": ["warn", {
  "selector": "CallExpression[callee.object.name=/^(Project|ApiKey|APIUsage|UsageRollup|DetectionRule|SecurityRule|Environment|Team|Membership)$/][callee.property.name=/^(find|findOne|findById|updateOne|updateMany|deleteOne|deleteMany|aggregate)$/]",
  "message": "Use tenantRepo(req, Model) in management controllers, not a raw Model query."
}]
```

## Tests

- `npm run test:rbac` — pure engine (matrix, scope coverage, additive union).
- `npm run test:isolation` — cross-org denial on reads AND writes + same-org
  least privilege (needs Mongo).
