import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Environment } from "../models/environment.model.js";
import { ApiKey } from "../models/apikey.model.js";
import { tenantRepo } from "../utils/tenantScope.js";

// POST /projects/:projectId/environments — authorize("environment","create").
const createEnvironment = asyncHandler(async (req, res) => {
    const project = req.tenant.project;
    const { name } = req.body || {};
    if (!name?.trim()) throw new APIError(400, "Environment name is required");
    const exists = await Environment.findOne({ projectId: project._id, name: name.trim() });
    if (exists) throw new APIError(409, "An environment with that name already exists");
    const env = await tenantRepo(req, Environment).create({ projectId: project._id, name: name.trim() });
    return res.status(201).json(new APIResponse(201, env, "Environment created"));
});

// GET /projects/:projectId/environments — authorize("environment","read").
const listEnvironments = asyncHandler(async (req, res) => {
    const envs = await tenantRepo(req, Environment).find({ projectId: req.tenant.project._id }).sort({ isDefault: -1, name: 1 });
    return res.status(200).json(new APIResponse(200, envs, "Environments fetched"));
});

// DELETE /projects/:projectId/environments/:envId — authorize("environment","delete").
// Refuses the default env and any env that still has API keys (rotate/revoke first).
const deleteEnvironment = asyncHandler(async (req, res) => {
    const { envId } = req.params;
    const env = await tenantRepo(req, Environment).findOne({ _id: envId, projectId: req.tenant.project._id });
    if (!env) throw new APIError(404, "Environment not found");
    if (env.isDefault) throw new APIError(409, "Cannot delete the default environment");
    const keyCount = await ApiKey.countDocuments({ environmentId: envId });
    if (keyCount > 0) throw new APIError(409, `Revoke the environment's ${keyCount} API key(s) first`);
    await Environment.deleteOne({ _id: envId });
    return res.status(200).json(new APIResponse(200, {}, "Environment deleted"));
});

export { createEnvironment, listEnvironments, deleteEnvironment };
