import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import crypto from "crypto";
import { Membership } from "../models/membership.model.js";
import { Invitation } from "../models/invitation.model.js";
import { User } from "../models/user.model.js";
import { Team } from "../models/team.model.js";
import { ROLES, SCOPE_TYPES } from "../rbac/roles.js";
import { sendEmail } from "../utils/sendEmail.js";
import { hashToken } from "../utils/tokens.js";

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS ?? 7);

// Is the caller an org-scoped owner? Only owners may grant/modify the owner role.
const callerIsOwner = (req) =>
    (req.memberships || []).some((m) => m.scopeType === "org" && m.role === "owner");

// Count remaining org-scoped owners so we never orphan an org (last-owner guard).
const orgOwnerCount = (organizationId) =>
    Membership.countDocuments({ organizationId, scopeType: "org", role: "owner" });

function normalizeScope({ scopeType = "org", teamId = null, projectId = null }) {
    if (!SCOPE_TYPES.includes(scopeType)) throw new APIError(400, "Invalid scopeType");
    if (scopeType === "org") return { scopeType, teamId: null, projectId: null };
    if (scopeType === "team") { if (!teamId) throw new APIError(400, "team scope needs teamId"); return { scopeType, teamId, projectId: null }; }
    if (!projectId) throw new APIError(400, "project scope needs projectId");
    return { scopeType, teamId: teamId || null, projectId };
}

// GET /orgs/:orgId/members — authorize("member","read"). Members + their grants.
const listMembers = asyncHandler(async (req, res) => {
    const organizationId = req.tenant.organizationId;
    const grants = await Membership.find({ organizationId }).select("userId scopeType teamId projectId role");
    const userIds = [...new Set(grants.map((g) => String(g.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select("username email");
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const members = userIds.map((id) => ({
        userId: id,
        username: byId.get(id)?.username,
        email: byId.get(id)?.email,
        grants: grants.filter((g) => String(g.userId) === id)
            .map((g) => ({ scopeType: g.scopeType, role: g.role, teamId: g.teamId, projectId: g.projectId })),
    }));
    return res.status(200).json(new APIResponse(200, members, "Members fetched"));
});

// POST /orgs/:orgId/members/invite — authorize("member","create").
const inviteMember = asyncHandler(async (req, res) => {
    const organizationId = req.tenant.organizationId;
    const { email, role } = req.body || {};
    if (!email?.trim()) throw new APIError(400, "email is required");
    if (!ROLES.includes(role)) throw new APIError(400, "Invalid role");
    if (role === "owner" && !callerIsOwner(req)) throw new APIError(403, "Only an owner can grant the owner role");
    const scope = normalizeScope(req.body || {});
    if (scope.teamId) {
        const team = await Team.findOne({ _id: scope.teamId, organizationId });
        if (!team) throw new APIError(400, "teamId does not belong to this org");
    }

    const rawToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Replace any prior pending invite for this (org, email).
    await Invitation.deleteMany({ organizationId, email: email.toLowerCase().trim(), status: "pending" });
    const invite = await Invitation.create({
        organizationId, email: email.toLowerCase().trim(), role, ...scope,
        tokenHash: hashToken(rawToken), invitedBy: req.user._id, expiresAt,
    });

    const acceptUrl = `${(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0]}/invite?token=${rawToken}`;
    try {
        await sendEmail(email, `You've been invited to join an organization on SecureFlow as ${role}.\n\nAccept: ${acceptUrl}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`);
    } catch (e) {
        // Don't fail the invite if SMTP is down in dev — surface the URL instead.
        req.log?.warn?.("invite_email_failed", { message: e?.message });
    }

    return res.status(201).json(new APIResponse(201, {
        invitationId: invite._id, email: invite.email, role, scopeType: scope.scopeType, expiresAt,
        // Dev convenience: the accept URL (in prod the user gets it by email only).
        acceptUrl: process.env.NODE_ENV === "production" ? undefined : acceptUrl,
    }, "Invitation sent"));
});

// POST /orgs/invites/accept — verifyJWT only. The invited user redeems the token.
const acceptInvite = asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    if (!token) throw new APIError(400, "token is required");
    const invite = await Invitation.findOne({ tokenHash: hashToken(token), status: "pending" });
    if (!invite || invite.expiresAt < new Date()) throw new APIError(400, "Invitation is invalid or expired");
    if (invite.email !== req.user.email?.toLowerCase()) throw new APIError(403, "This invitation was issued to a different email");

    await Membership.updateOne(
        { userId: req.user._id, organizationId: invite.organizationId, scopeType: invite.scopeType, teamId: invite.teamId, projectId: invite.projectId },
        { $set: { role: invite.role } },
        { upsert: true }
    );
    invite.status = "accepted";
    await invite.save();

    return res.status(200).json(new APIResponse(200, { organizationId: invite.organizationId, role: invite.role }, "Invitation accepted"));
});

// PATCH /orgs/:orgId/members/:userId — authorize("member","update"). Set the
// target's grant at a scope. Owner-only for owner grants; last-owner guard.
const changeMemberRole = asyncHandler(async (req, res) => {
    const organizationId = req.tenant.organizationId;
    const { userId } = req.params;
    const { role } = req.body || {};
    if (!ROLES.includes(role)) throw new APIError(400, "Invalid role");
    if (role === "owner" && !callerIsOwner(req)) throw new APIError(403, "Only an owner can grant the owner role");
    const scope = normalizeScope(req.body || {});

    // If demoting an org-owner, make sure they aren't the last one.
    if (scope.scopeType === "org" && role !== "owner") {
        const isOwner = await Membership.exists({ userId, organizationId, scopeType: "org", role: "owner" });
        if (isOwner && (await orgOwnerCount(organizationId)) <= 1) throw new APIError(409, "Cannot demote the last owner");
    }

    await Membership.updateOne(
        { userId, organizationId, scopeType: scope.scopeType, teamId: scope.teamId, projectId: scope.projectId },
        { $set: { role } },
        { upsert: true }
    );
    return res.status(200).json(new APIResponse(200, { userId, ...scope, role }, "Member role updated"));
});

// DELETE /orgs/:orgId/members/:userId — authorize("member","delete"). Removes all
// of the target's grants in the org. Last-owner guard.
const removeMember = asyncHandler(async (req, res) => {
    const organizationId = req.tenant.organizationId;
    const { userId } = req.params;
    const isOwner = await Membership.exists({ userId, organizationId, scopeType: "org", role: "owner" });
    if (isOwner && (await orgOwnerCount(organizationId)) <= 1) throw new APIError(409, "Cannot remove the last owner");
    const result = await Membership.deleteMany({ userId, organizationId });
    if (!result.deletedCount) throw new APIError(404, "Member not found in this organization");
    return res.status(200).json(new APIResponse(200, {}, "Member removed"));
});

export { listMembers, inviteMember, acceptInvite, changeMemberRole, removeMember };
