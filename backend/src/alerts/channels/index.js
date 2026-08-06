import axios from "axios";
import crypto from "crypto";
import { sendEmail } from "../../utils/sendEmail.js";

// Channel adapters (Phase 3.7). Each turns a fired Alert into a notification on a
// destination. ALL fail-open: dispatch() never throws, so a broken channel can't
// block the worker or the stream ACK — it returns { ok:false, error } and the
// worker logs it. (Retry queue is deferred — a failed notification is logged,
// not retried.)
const HTTP_TIMEOUT_MS = Number(process.env.ALERT_HTTP_TIMEOUT_MS ?? 5000);

// Human-readable summary used for email/slack bodies.
export function formatAlertText(alert) {
    const c = alert.context || {};
    const lines = [
        `[${String(alert.severity).toUpperCase()}] ${alert.title || "SecureFlow alert"}`,
        `status: ${c.status ?? "-"}   risk: ${c.riskScore ?? "-"}   action: ${c.action ?? "-"}`,
        c.topSignal ? `signal: ${c.topSignal}` : null,
        c.ip ? `ip: ${c.ip}` : null,
        c.fingerprint ? `fingerprint: ${c.fingerprint}` : null,
        `occurrences: ${alert.count ?? 1}   first: ${alert.firstSeenAt?.toISOString?.() ?? alert.firstSeenAt}`,
    ].filter(Boolean);
    return lines.join("\n");
}

// Machine payload for generic webhooks.
export function alertPayload(alert) {
    return {
        id: String(alert._id),
        severity: alert.severity,
        title: alert.title,
        status: alert.status,
        count: alert.count,
        context: alert.context || {},
        firstSeenAt: alert.firstSeenAt,
        lastSeenAt: alert.lastSeenAt,
    };
}

async function emailChannel(channel, alert) {
    const to = channel.config?.email;
    if (!to) return { ok: false, error: "channel has no email configured" };
    await sendEmail(to, formatAlertText(alert), `[SecureFlow ${alert.severity}] ${alert.title || "alert"}`);
    return { ok: true };
}

async function slackChannel(channel, alert) {
    const url = channel.config?.slackWebhookUrl;
    if (!url) return { ok: false, error: "channel has no slackWebhookUrl" };
    await axios.post(url, { text: formatAlertText(alert) }, { timeout: HTTP_TIMEOUT_MS });
    return { ok: true };
}

async function webhookChannel(channel, alert) {
    const url = channel.config?.url;
    if (!url) return { ok: false, error: "channel has no url" };
    const body = JSON.stringify(alertPayload(alert));
    const headers = { "Content-Type": "application/json" };
    // Sign the raw body so the receiver can verify authenticity (HMAC-SHA256).
    if (channel.config?.secret) {
        const sig = crypto.createHmac("sha256", channel.config.secret).update(body).digest("hex");
        headers["X-SecureFlow-Signature"] = `sha256=${sig}`;
    }
    await axios.post(url, body, { headers, timeout: HTTP_TIMEOUT_MS });
    return { ok: true };
}

const ADAPTERS = { email: emailChannel, slack: slackChannel, webhook: webhookChannel };

// Dispatch one alert to one channel. Fail-open — never throws.
export async function dispatch(channel, alert) {
    if (!channel) return { ok: false, error: "no channel" };
    if (channel.enabled === false) return { ok: false, error: "channel disabled" };
    const adapter = ADAPTERS[channel.type];
    if (!adapter) return { ok: false, error: `unknown channel type ${channel.type}` };
    try {
        return await adapter(channel, alert);
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}
