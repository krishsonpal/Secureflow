// Minimal in-process circuit breaker. Wraps a flaky dependency (the ML service)
// so that once it starts failing we stop calling it for a cooldown window and
// degrade immediately — instead of paying the timeout on every single request.
//
// States: CLOSED (normal) → OPEN (skip calls) → HALF_OPEN (allow one trial).
export class CircuitBreaker {
    constructor({ failureThreshold = 5, cooldownMs = 30000, name = "cb" } = {}) {
        this.failureThreshold = failureThreshold
        this.cooldownMs = cooldownMs
        this.name = name
        this.failures = 0
        this.state = "CLOSED"
        this.openedAt = 0
    }

    // Should the caller attempt the real request right now?
    canRequest() {
        if (this.state === "OPEN") {
            if (Date.now() - this.openedAt >= this.cooldownMs) {
                this.state = "HALF_OPEN" // let one trial through
                return true
            }
            return false
        }
        return true // CLOSED or HALF_OPEN
    }

    onSuccess() {
        this.failures = 0
        if (this.state !== "CLOSED") {
            this.state = "CLOSED"
            console.log(`[cb:${this.name}] closed (recovered)`)
        }
    }

    onFailure() {
        this.failures++
        if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
            if (this.state !== "OPEN") {
                console.warn(`[cb:${this.name}] OPEN after ${this.failures} failure(s); cooling down ${this.cooldownMs}ms`)
            }
            this.state = "OPEN"
            this.openedAt = Date.now()
        }
    }

    get status() {
        return this.state
    }
}
