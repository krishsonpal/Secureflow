import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiKey } from "../models/apikey.model.js";
import { Environment } from "../models/environment.model.js";
import { generateApiKey } from "../utils/tokens.js";
import { tenantOrgId } from "../utils/tenantScope.js";

// Auth handled by verifyJWT + authorize("apikey","create"), which resolves the
// project's tenant scope and verifies the caller may create keys there
// (req.tenant.project). The stored `key` is a sha256 HASH; the plaintext
// `sk_live_…` key is returned exactly once and never persisted or shown again.
const creatNewAPIKey = asyncHandler(async (req, res) => {
    const project = req.tenant.project
    const organizationId = tenantOrgId(req)

    // Keys are scoped to an environment (Phase 3.1). Use an explicit one (must
    // belong to this project) or fall back to the project's default env.
    let env
    if (req.body.environmentId) {
        env = await Environment.findOne({ _id: req.body.environmentId, projectId: project._id, organizationId })
        if (!env) throw new APIError(400, "environmentId does not belong to this project")
    } else {
        env = await Environment.findOne({ projectId: project._id, isDefault: true })
            || await Environment.create({ projectId: project._id, organizationId, name: "production", isDefault: true })
    }

    const { full, hash, prefix } = generateApiKey()

    const apiKey = await ApiKey.create({
        key: hash,
        keyPrefix: prefix,
        userId: req.user._id,
        organizationId,
        projectId: project._id,
        environmentId: env._id,
        lastUsedAt: new Date()
    })

    return res
        .status(201)
        .json(new APIResponse(201, {
            id: apiKey._id,
            key: full,            // shown ONCE — store it now
            keyPrefix: prefix,
            projectId: apiKey.projectId,
            environmentId: apiKey.environmentId,
            credits: apiKey.credits,
            createdAt: apiKey.createdAt
        }, "New APIKey created. Copy it now — it will not be shown again."))
})

export {
    creatNewAPIKey
}
