import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import { AlertChannel } from "../models/alertchannel.model.js";
import { AlertRule } from "../models/alertrule.model.js";
import { Alert } from "../models/alert.model.js";
import { Project } from "../models/project.model.js";
import { validateConditions } from "../detection/ruleEngine.js";
import { invalidateAlertRules } from "../utils/alertRules.js";
import { dispatch } from "../alerts/channels/index.js";
import { tenantRepo } from "../utils/tenantScope.js";

// Phase 3.8 — org-scoped management API for alerting. Routes are gated by
// authorize("alert", …) with the org resolver; every query goes through
// tenantRepo so a request can only ever touch its own org's rows.

const CHANNEL_TYPES = ["email", "slack", "webhook"];
const SEVERITIES = ["info", "warning", "critical"];
const DEDUP_BY = ["fingerprint", "ip", "identity"];

// --- Channels ---------------------------------------------------------------

const listChannels = asyncHandler(async (req, res) => {
    const channels = await tenantRepo(req, AlertChannel).find({}).sort({ name: 1 });
    return res.status(200).json(new APIResponse(200, channels, "Channels fetched"));
});

const createChannel = asyncHandler(async (req, res) => {
    const { name, type, config } = req.body || {};
    if (!name?.trim()) throw new APIError(400, "Channel name is required");
    if (!CHANNEL_TYPES.includes(type)) throw new APIError(400, `type must be one of ${CHANNEL_TYPES.join(", ")}`);
    const channel = await tenantRepo(req, AlertChannel).create({
        name: name.trim(), type, config: config || {}, enabled: req.body.enabled !== false,
    });
    return res.status(201).json(new APIResponse(201, channel, "Channel created"));
});

const updateChannel = asyncHandler(async (req, res) => {
    const set = {};
    for (const k of ["name", "config", "enabled"]) if (req.body?.[k] !== undefined) set[k] = req.body[k];
    const channel = await tenantRepo(req, AlertChannel).findOneAndUpdate({ _id: req.params.channelId }, { $set: set }, { new: true });
    if (!channel) throw new APIError(404, "Channel not found");
    return res.status(200).json(new APIResponse(200, channel, "Channel updated"));
});

const deleteChannel = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await tenantRepo(req, AlertChannel).deleteOne({ _id: channelId });
    if (!result.deletedCount) throw new APIError(404, "Channel not found");
    // Drop the dangling reference from any rules that used it.
    await tenantRepo(req, AlertRule).updateMany({ channelIds: channelId }, { $pull: { channelIds: channelId } });
    await invalidateAlertRules(req.tenant.organizationId);
    return res.status(200).json(new APIResponse(200, {}, "Channel deleted"));
});

// Send a synthetic alert through a channel so the user can confirm it works.
const testChannel = asyncHandler(async (req, res) => {
    const channel = await tenantRepo(req, AlertChannel).findById(req.params.channelId);
    if (!channel) throw new APIError(404, "Channel not found");
    const now = new Date();
    const testAlert = {
        _id: new mongoose.Types.ObjectId(), severity: "info", title: "SecureFlow test alert",
        status: "open", count: 1, firstSeenAt: now, lastSeenAt: now,
        context: { status: "test", riskScore: 0, action: "n/a", topSignal: "test", ip: "", fingerprint: "" },
    };
    const result = await dispatch(channel, testAlert);
    if (!result.ok) throw new APIError(502, `Channel test failed: ${result.error}`);
    return res.status(200).json(new APIResponse(200, { ok: true }, "Test notification sent"));
});

// --- Rules ------------------------------------------------------------------

async function normalizeRuleInput(req) {
    const b = req.body || {};
    const out = {};
    if (b.name !== undefined) { if (!String(b.name).trim()) throw new APIError(400, "Rule name is required"); out.name = String(b.name).trim(); }
    if (b.conditions !== undefined) {
        const err = validateConditions(b.conditions);
        if (err) throw new APIError(400, `Invalid conditions: ${err}`);
        out.conditions = b.conditions;
    }
    if (b.severity !== undefined) { if (!SEVERITIES.includes(b.severity)) throw new APIError(400, "Invalid severity"); out.severity = b.severity; }
    if (b.dedupBy !== undefined) { if (!DEDUP_BY.includes(b.dedupBy)) throw new APIError(400, "Invalid dedupBy"); out.dedupBy = b.dedupBy; }
    if (b.dedupWindowSec !== undefined) { const n = Number(b.dedupWindowSec); if (Number.isFinite(n) && n >= 0) out.dedupWindowSec = n; }
    if (b.enabled !== undefined) out.enabled = Boolean(b.enabled);
    if (b.snoozedUntil !== undefined) out.snoozedUntil = b.snoozedUntil ? new Date(b.snoozedUntil) : null;
    if (b.projectId !== undefined) {
        if (b.projectId === null) out.projectId = null;
        else {
            const owned = await tenantRepo(req, Project).findById(b.projectId);
            if (!owned) throw new APIError(400, "projectId does not belong to this org");
            out.projectId = b.projectId;
        }
    }
    if (b.channelIds !== undefined) {
        const ids = Array.isArray(b.channelIds) ? b.channelIds : [];
        if (ids.length) {
            const validCount = await tenantRepo(req, AlertChannel).countDocuments({ _id: { $in: ids } });
            if (validCount !== ids.length) throw new APIError(400, "One or more channelIds do not belong to this org");
        }
        out.channelIds = ids;
    }
    return out;
}

const listRules = asyncHandler(async (req, res) => {
    const rules = await tenantRepo(req, AlertRule).find({}).sort({ createdAt: -1 });
    return res.status(200).json(new APIResponse(200, rules, "Alert rules fetched"));
});

const createRule = asyncHandler(async (req, res) => {
    const input = await normalizeRuleInput(req);
    if (!input.name) throw new APIError(400, "Rule name is required");
    if (!input.conditions) throw new APIError(400, "conditions are required");
    const rule = await tenantRepo(req, AlertRule).create(input);
    await invalidateAlertRules(req.tenant.organizationId);
    return res.status(201).json(new APIResponse(201, rule, "Alert rule created"));
});

const updateRule = asyncHandler(async (req, res) => {
    const input = await normalizeRuleInput(req);
    const rule = await tenantRepo(req, AlertRule).findOneAndUpdate({ _id: req.params.ruleId }, { $set: input }, { new: true });
    if (!rule) throw new APIError(404, "Alert rule not found");
    await invalidateAlertRules(req.tenant.organizationId);
    return res.status(200).json(new APIResponse(200, rule, "Alert rule updated"));
});

const deleteRule = asyncHandler(async (req, res) => {
    const result = await tenantRepo(req, AlertRule).deleteOne({ _id: req.params.ruleId });
    if (!result.deletedCount) throw new APIError(404, "Alert rule not found");
    await invalidateAlertRules(req.tenant.organizationId);
    return res.status(200).json(new APIResponse(200, {}, "Alert rule deleted"));
});

// --- Alerts (Alert Center) --------------------------------------------------

const listAlerts = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status && ["open", "acknowledged", "resolved"].includes(req.query.status)) filter.status = req.query.status;
    if (req.query.severity && SEVERITIES.includes(req.query.severity)) filter.severity = req.query.severity;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const alerts = await tenantRepo(req, Alert).find(filter).sort({ lastSeenAt: -1 }).limit(limit);
    return res.status(200).json(new APIResponse(200, alerts, "Alerts fetched"));
});

const acknowledgeAlert = asyncHandler(async (req, res) => {
    const alert = await tenantRepo(req, Alert).findOneAndUpdate(
        { _id: req.params.alertId },
        { $set: { status: "acknowledged", acknowledgedBy: req.user._id, acknowledgedAt: new Date() } },
        { new: true }
    );
    if (!alert) throw new APIError(404, "Alert not found");
    return res.status(200).json(new APIResponse(200, alert, "Alert acknowledged"));
});

const resolveAlert = asyncHandler(async (req, res) => {
    const alert = await tenantRepo(req, Alert).findOneAndUpdate(
        { _id: req.params.alertId },
        { $set: { status: "resolved", resolvedBy: req.user._id, resolvedAt: new Date() } },
        { new: true }
    );
    if (!alert) throw new APIError(404, "Alert not found");
    return res.status(200).json(new APIResponse(200, alert, "Alert resolved"));
});

export {
    listChannels, createChannel, updateChannel, deleteChannel, testChannel,
    listRules, createRule, updateRule, deleteRule,
    listAlerts, acknowledgeAlert, resolveAlert,
};
