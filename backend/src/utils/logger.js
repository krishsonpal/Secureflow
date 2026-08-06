// Minimal structured (JSON) logger with secret redaction. One line per event so
// logs are machine-parseable (ship to Loki/CloudWatch/etc.) and safe — known
// sensitive keys are masked so a stray object never leaks a token or password.
// No dependency; a heavier lib (pino/winston) can drop in later behind this API.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const ACTIVE_LEVEL = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

// Keys whose values must never appear in logs (case-insensitive, substring match).
const REDACT_KEYS = [
    "password", "token", "accesstoken", "refreshtoken", "apikey", "api_key",
    "x-api-key", "authorization", "secret", "cookie", "credit",
];

const shouldRedact = (key) => {
    const k = String(key).toLowerCase();
    return REDACT_KEYS.some((r) => k.includes(r));
};

// Recursively redact sensitive fields; depth/size capped so logging can't be
// turned into a CPU sink by a huge/cyclic object.
const redact = (value, depth = 0, seen = new WeakSet()) => {
    if (depth > 6 || value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = shouldRedact(k) ? "[REDACTED]" : redact(v, depth + 1, seen);
    }
    return out;
};

const emit = (level, msg, meta) => {
    if (LEVELS[level] > ACTIVE_LEVEL) return;
    const line = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...(meta ? redact(meta) : {}),
    };
    const out = JSON.stringify(line);
    if (level === "error") console.error(out);
    else if (level === "warn") console.warn(out);
    else console.log(out);
};

const make = (base = {}) => ({
    error: (msg, meta) => emit("error", msg, { ...base, ...meta }),
    warn: (msg, meta) => emit("warn", msg, { ...base, ...meta }),
    info: (msg, meta) => emit("info", msg, { ...base, ...meta }),
    debug: (msg, meta) => emit("debug", msg, { ...base, ...meta }),
    // Bind context (e.g. a correlationId) into every line from the child.
    child: (bindings) => make({ ...base, ...bindings }),
});

export const logger = make();
