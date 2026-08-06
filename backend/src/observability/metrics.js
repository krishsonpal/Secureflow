import client from "prom-client";

// Single Prometheus registry for the process. Default metrics give us Node/proc
// health (event-loop lag, GC, memory, CPU) for free; the custom metrics below
// cover HTTP throughput/latency and a few security-relevant hot-path events.
export const registry = new client.Registry();
registry.setDefaultLabels({ app: "secureflow-backend" });
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
});

// Security hot-path counters — surfaced on the dashboard/alerts. Incremented from
// the relevant middleware so they don't depend on log scraping.
export const securityEventsTotal = new client.Counter({
    name: "secureflow_security_events_total",
    help: "Security-relevant events by type",
    labelNames: ["type"], // xss_blocked | rate_limited | credits_exhausted | key_revoked | session_theft
    registers: [registry],
});

export const incSecurityEvent = (type) => {
    try { securityEventsTotal.inc({ type }); } catch { /* never let metrics break a request */ }
};

// Collapse high-cardinality paths (ids) into route templates so the label set
// stays bounded. Best-effort: prefer the matched Express route when available.
export const routeLabel = (req) => {
    const base = req.baseUrl || "";
    const path = req.route?.path || req.path || "unknown";
    let route = (base + path) || "unknown";
    // Replace Mongo ObjectIds and long hex/uuid-ish segments with :id.
    route = route.replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id");
    return route;
};

export const metricsContentType = registry.contentType;
