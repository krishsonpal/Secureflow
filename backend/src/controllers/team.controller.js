import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Team } from "../models/team.model.js";
import { Project } from "../models/project.model.js";

// POST /orgs/:orgId/teams — authorize("team","create").
const createTeam = asyncHandler(async (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) throw new APIError(400, "Team name is required");
    const organizationId = req.tenant.organizationId;
    const exists = await Team.findOne({ organizationId, name: name.trim() });
    if (exists) throw new APIError(409, "A team with that name already exists");
    const team = await Team.create({ organizationId, name: name.trim() });
    return res.status(201).json(new APIResponse(201, team, "Team created"));
});

// GET /orgs/:orgId/teams — authorize("team","read").
const listTeams = asyncHandler(async (req, res) => {
    const teams = await Team.find({ organizationId: req.tenant.organizationId }).sort({ isDefault: -1, name: 1 });
    return res.status(200).json(new APIResponse(200, teams, "Teams fetched"));
});

// PATCH /orgs/:orgId/teams/:teamId — authorize("team","update").
const updateTeam = asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const set = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) set.name = req.body.name.trim();
    // Scope the update to the resolved tenant so a mismatched org/team can't slip through.
    const team = await Team.findOneAndUpdate(
        { _id: teamId, organizationId: req.tenant.organizationId },
        { $set: set }, { new: true }
    );
    if (!team) throw new APIError(404, "Team not found");
    return res.status(200).json(new APIResponse(200, team, "Team updated"));
});

// DELETE /orgs/:orgId/teams/:teamId — authorize("team","delete"). Refuses the
// default team and any team that still owns projects (reassign first).
const deleteTeam = asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const team = await Team.findOne({ _id: teamId, organizationId: req.tenant.organizationId });
    if (!team) throw new APIError(404, "Team not found");
    if (team.isDefault) throw new APIError(409, "Cannot delete the default team");
    const projectCount = await Project.countDocuments({ teamId, organizationId: req.tenant.organizationId });
    if (projectCount > 0) throw new APIError(409, `Reassign the team's ${projectCount} project(s) first`);
    await Team.deleteOne({ _id: teamId });
    return res.status(200).json(new APIResponse(200, {}, "Team deleted"));
});

export { createTeam, listTeams, updateTeam, deleteTeam };
