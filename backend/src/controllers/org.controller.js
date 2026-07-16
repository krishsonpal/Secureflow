import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import crypto from "crypto";
import { Organization } from "../models/organization.model.js";
import { Team } from "../models/team.model.js";
import { Membership } from "../models/membership.model.js";
import { Invitation } from "../models/invitation.model.js";
import { Project } from "../models/project.model.js";

const slugify = (name) =>
    `${String(name || "org").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "org"}-${crypto.randomBytes(3).toString("hex")}`;

// Bootstrap a new org: default team + Owner membership for the creator. Shared
// with the backfill's shape so orgs are structurally identical however created.
async function bootstrapOrg({ name, ownerUserId }) {
    const org = await Organization.create({ name, slug: slugify(name), ownerUserId, plan: "free" });
    const team = await Team.create({ organizationId: org._id, name: "Default", isDefault: true });
    await Membership.create({ userId: ownerUserId, organizationId: org._id, scopeType: "org", role: "owner" });
    return { org, team };
}

// POST /orgs — any authenticated user can create an org (becomes its Owner).
// Bootstrap only (no existing tenant to authorize against).
const createOrg = asyncHandler(async (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) throw new APIError(400, "Organization name is required");
    const { org } = await bootstrapOrg({ name: name.trim(), ownerUserId: req.user._id });
    return res.status(201).json(new APIResponse(201, org, "Organization created"));
});

// GET /orgs — orgs the caller is a member of (across all their grants).
const listMyOrgs = asyncHandler(async (req, res) => {
    const orgIds = await Membership.distinct("organizationId", { userId: req.user._id });
    const orgs = await Organization.find({ _id: { $in: orgIds } }).select("name slug plan ownerUserId createdAt");
    return res.status(200).json(new APIResponse(200, orgs, "Organizations fetched"));
});

// GET /orgs/:orgId — authorize("org","read").
const getOrg = asyncHandler(async (req, res) => {
    const org = await Organization.findById(req.tenant.organizationId).select("name slug plan ownerUserId createdAt");
    if (!org) throw new APIError(404, "Organization not found");
    return res.status(200).json(new APIResponse(200, org, "Organization fetched"));
});

// PATCH /orgs/:orgId — authorize("org","update").
const updateOrg = asyncHandler(async (req, res) => {
    const set = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) set.name = req.body.name.trim();
    const org = await Organization.findByIdAndUpdate(req.tenant.organizationId, { $set: set }, { new: true })
        .select("name slug plan ownerUserId");
    if (!org) throw new APIError(404, "Organization not found");
    return res.status(200).json(new APIResponse(200, org, "Organization updated"));
});

// DELETE /orgs/:orgId — authorize("org","delete"). Refuses if the org still has
// projects (must be emptied first) to avoid orphaning tenant data.
const deleteOrg = asyncHandler(async (req, res) => {
    const orgId = req.tenant.organizationId;
    const projectCount = await Project.countDocuments({ organizationId: orgId });
    if (projectCount > 0) throw new APIError(409, `Delete the org's ${projectCount} project(s) first`);
    await Promise.all([
        Membership.deleteMany({ organizationId: orgId }),
        Team.deleteMany({ organizationId: orgId }),
        Invitation.deleteMany({ organizationId: orgId }),
        Organization.deleteOne({ _id: orgId }),
    ]);
    return res.status(200).json(new APIResponse(200, {}, "Organization deleted"));
});

export { createOrg, listMyOrgs, getOrg, updateOrg, deleteOrg };
