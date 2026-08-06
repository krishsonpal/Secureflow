import { APIError } from "./apierror.js"

// Phase 3.3 — tenant isolation by CONSTRUCTION.
//
// The organizationId is the tenant boundary; every management query must filter
// by it. Rather than trusting each caller to remember, `tenantRepo(req, Model)`
// injects it internally so a new query is scoped for free and CANNOT leak across
// tenants. `tenantFilter` is the low-level primitive for the few spots the repo
// wrapper doesn't fit (custom aggregation $match stages).
//
// CONVENTION: in management controllers, prefer tenantRepo(req, Model) over raw
// Model.find/.findOne/... An optional ESLint guard (see .eslintrc note) can flag
// direct tenant-model queries outside this data-access layer later.

// The tenant the request is authorized against. authorize() caches the resolved
// scope on req.tenant; fall back to the caller's home org for routes that run
// before/without authorize. Fail CLOSED — never return an unscoped filter.
export function tenantOrgId(req) {
    const orgId = req?.tenant?.organizationId || req?.user?.organizationId
    if (!orgId) throw new APIError(403, "Forbidden: no tenant scope")
    return orgId
}

// { ...extra, organizationId }. organizationId always wins so a caller can't
// widen or spoof the tenant by passing their own.
export function tenantFilter(req, extra = {}) {
    return { ...extra, organizationId: tenantOrgId(req) }
}

// Model wrapper whose every method is pre-scoped to the request's tenant.
// (aggregate prepends a { $match: { organizationId } } — pass ObjectId-typed
// scope, which req.tenant/req.user already are.)
export function tenantRepo(req, Model) {
    const scope = () => ({ organizationId: tenantOrgId(req) })
    return {
        find: (f = {}) => Model.find({ ...f, ...scope() }),
        findOne: (f = {}) => Model.findOne({ ...f, ...scope() }),
        findById: (id) => Model.findOne({ _id: id, ...scope() }),
        countDocuments: (f = {}) => Model.countDocuments({ ...f, ...scope() }),
        create: (doc) => Model.create({ ...doc, ...scope() }),
        updateOne: (f, update, opts) => Model.updateOne({ ...f, ...scope() }, update, opts),
        updateMany: (f, update, opts) => Model.updateMany({ ...f, ...scope() }, update, opts),
        findOneAndUpdate: (f, update, opts) => Model.findOneAndUpdate({ ...f, ...scope() }, update, opts),
        deleteOne: (f = {}) => Model.deleteOne({ ...f, ...scope() }),
        deleteMany: (f = {}) => Model.deleteMany({ ...f, ...scope() }),
        aggregate: (pipeline = []) => Model.aggregate([{ $match: scope() }, ...pipeline]),
        scope, // escape hatch for hand-built queries
    }
}
