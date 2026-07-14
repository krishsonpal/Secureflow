import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";
import { httpRequestsTotal, httpRequestDuration, routeLabel } from "../observability/metrics.js";

// Assign a correlation id to every request (honoring an inbound X-Request-Id from
// an upstream proxy/gateway so a trace spans services). Exposed as req.id, echoed
// in the response header, and bound onto req.log so every downstream log line for
// this request carries it.
export const correlationId = (req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id = (typeof incoming === "string" && incoming.trim()) ? incoming.trim().slice(0, 120) : randomUUID();
    req.id = id;
    req.log = logger.child({ correlationId: id });
    res.setHeader("X-Request-Id", id);
    next();
};

// Log one structured line per completed request and record Prometheus HTTP
// metrics (count + duration) labeled by method/route/status. Route is templated
// (ids collapsed) so label cardinality stays bounded.
export const requestObserver = (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };

        try {
            httpRequestsTotal.inc(labels);
            httpRequestDuration.observe(labels, durationSec);
        } catch { /* metrics must never break the request */ }

        const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
        (req.log || logger)[level]("http_request", {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Math.round(durationSec * 1000),
            ip: req.ip,
        });
    });

    next();
};
