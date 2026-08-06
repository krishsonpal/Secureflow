// Rule engine (Phase 2.2) — a small, safe, synchronous evaluator over a JSON
// condition tree. No eval, no I/O; pure and unit-testable. Conditions run over an
// "evaluation context" the decision middleware builds from the fused score + the
// individual detector signals + request features.
//
// Grammar:
//   node   := group | leaf
//   group  := { all: node[] } | { any: node[] }
//   leaf   := { fact: "<dotted.path>", operator: "<op>", value: <literal> }

const MAX_DEPTH = 6;

// Whitelisted operators (never eval user input). `matches` caps pattern length as
// a light ReDoS guard and fails closed on a bad pattern.
const OPERATORS = {
    equal: (a, b) => a === b,
    notEqual: (a, b) => a !== b,
    greaterThan: (a, b) => Number(a) > Number(b),
    greaterThanInclusive: (a, b) => Number(a) >= Number(b),
    lessThan: (a, b) => Number(a) < Number(b),
    lessThanInclusive: (a, b) => Number(a) <= Number(b),
    in: (a, b) => Array.isArray(b) && b.includes(a),
    notIn: (a, b) => Array.isArray(b) && !b.includes(a),
    contains: (a, b) =>
        typeof a === "string" ? a.includes(b) : Array.isArray(a) ? a.includes(b) : false,
    matches: (a, b) => {
        if (typeof b !== "string" || b.length > 200) return false;
        try {
            return new RegExp(b).test(String(a));
        } catch {
            return false;
        }
    },
    exists: (a) => a !== undefined && a !== null,
};

export const SUPPORTED_OPERATORS = Object.keys(OPERATORS);

// Resolve a dotted path over the context (own-property traversal only).
function resolveFact(ctx, path) {
    if (typeof path !== "string" || !path) return undefined;
    let cur = ctx;
    for (const part of path.split(".")) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = cur[part];
        if (cur === undefined) return undefined;
    }
    return cur;
}

function evaluateNode(node, ctx, depth) {
    if (depth > MAX_DEPTH || !node || typeof node !== "object") return false;
    if (Array.isArray(node.all)) return node.all.every((n) => evaluateNode(n, ctx, depth + 1));
    if (Array.isArray(node.any)) return node.any.some((n) => evaluateNode(n, ctx, depth + 1));
    const op = OPERATORS[node.operator];
    if (!op) return false;
    return Boolean(op(resolveFact(ctx, node.fact), node.value));
}

/**
 * Evaluate a project's rules against the context.
 * @returns {{matched: Array<{name,action,priority}>, action: string|null}}
 *   `matched` = every matching rule (incl. "log"), highest priority first;
 *   `action`  = the highest-priority *enforcing* (non-log) matched action, or null.
 */
export function evaluateRules(rules = [], ctx = {}) {
    const matched = [];
    for (const rule of rules) {
        if (rule.enabled === false) continue;
        try {
            if (evaluateNode(rule.conditions, ctx, 0)) {
                matched.push({ name: rule.name, action: rule.action, priority: rule.priority ?? 0 });
            }
        } catch {
            /* a malformed rule must never break the request */
        }
    }
    matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const winning = matched.find((m) => m.action !== "log") || null;
    return { matched, action: winning ? winning.action : null };
}

/**
 * Single-rule condition test (Phase 3.6 alerting). Same safe evaluator as
 * evaluateRules, exposed for callers that check one rule's conditions at a time
 * (the alert worker fires EVERY matching rule, not just the highest-priority one).
 * Never throws — a malformed tree is simply "no match".
 */
export function matchesRule(conditions, ctx = {}) {
    try {
        return evaluateNode(conditions, ctx, 0);
    } catch {
        return false;
    }
}

/**
 * Structurally validate a condition tree at write time. Returns an error string,
 * or null if valid. Keeps malformed rules out of the store and gives the admin
 * useful feedback (e.g. unsupported operator).
 */
export function validateConditions(node, depth = 0) {
    if (depth > MAX_DEPTH) return "conditions nested too deep";
    if (!node || typeof node !== "object" || Array.isArray(node)) return "condition must be an object";
    if (Array.isArray(node.all) || Array.isArray(node.any)) {
        const arr = node.all || node.any;
        if (!Array.isArray(arr) || arr.length === 0) return "all/any must be a non-empty array";
        for (const child of arr) {
            const err = validateConditions(child, depth + 1);
            if (err) return err;
        }
        return null;
    }
    if (typeof node.fact !== "string" || !node.fact) return "leaf condition needs a 'fact'";
    if (!SUPPORTED_OPERATORS.includes(node.operator)) return `unsupported operator '${node.operator}'`;
    return null;
}
