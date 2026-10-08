// Generated from apps/web/src/lib/drain.ts by scripts/build-drain.mjs. Do not edit.
const MAX_ATTEMPTS = 3;
const CLAIM_HEARTBEAT_MS = 2e4;
const REPORT_ATTEMPTS = 3;
class QueueDrainer {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  running = false;
  again = false;
  stopped = false;
  handled = /* @__PURE__ */ new Set();
  attempts = /* @__PURE__ */ new Map();
  unreported = /* @__PURE__ */ new Map();
  localhost = "ok";
  /** No new work starts; a forward already under way still reports. */
  stop() {
    this.stopped = true;
  }
  get localhostState() {
    return this.localhost;
  }
  /** Run a drain pass now, or once more after the current one finishes. */
  async wake() {
    if (this.stopped) return "idle";
    if (this.running) {
      this.again = true;
      return "idle";
    }
    this.running = true;
    let result = "idle";
    try {
      do {
        this.again = false;
        result = await this.pass();
      } while (this.again && result === "idle" && !this.stopped);
    } finally {
      this.running = false;
    }
    return result;
  }
  async pass() {
    let after = null;
    let open = 0;
    do {
      if (this.stopped) return "idle";
      const page = await this.deps.fetchPending(after);
      for (const evt of page.events) {
        if (this.stopped) return "idle";
        if (!this.handled.has(evt.id)) open++;
        const r = await this.step(evt);
        if (r !== "next") return r;
      }
      after = page.nextCursor;
    } while (after);
    if (open === 0) this.setLocalhost("ok");
    return "idle";
  }
  async step(evt) {
    if (this.handled.has(evt.id)) return "next";
    const owed = this.unreported.get(evt.id);
    if (owed) return await this.settle(evt, owed) ? "next" : "retry";
    if (this.deps.probe && (this.localhost !== "ok" || this.attempts.has(evt.id))) {
      const probe = await this.deps.probe(evt);
      if (probe.state !== "ok") {
        this.setLocalhost(probe.state, probe.message);
        return "retry";
      }
    }
    if (!await this.deps.claim(evt.id)) return "blocked";
    let lost = false;
    const setTimer = this.deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    const clearTimer = this.deps.clearTimer ?? ((h) => clearInterval(h));
    const heartbeat = setTimer(() => {
      this.deps.claim(evt.id).then((held) => {
        if (!held) lost = true;
      }).catch(() => {
      });
    }, CLAIM_HEARTBEAT_MS);
    let outcome;
    try {
      outcome = await this.deps.forward(evt);
    } finally {
      clearTimer(heartbeat);
    }
    if (lost) {
      this.handled.add(evt.id);
      this.attempts.delete(evt.id);
      return "next";
    }
    switch (outcome.kind) {
      case "response":
        this.attempts.delete(evt.id);
        this.setLocalhost("ok");
        return await this.settle(evt, { result: outcome.result }) ? "next" : "retry";
      case "down":
        this.setLocalhost("down", outcome.message);
        return "retry";
      case "cors":
        this.setLocalhost("cors", outcome.message);
        return "retry";
      case "timeout":
        this.attempts.delete(evt.id);
        return await this.settle(evt, terminal(outcome.message, outcome.latencyMs)) ? "next" : "retry";
      case "failed": {
        const tries = (this.attempts.get(evt.id) ?? 0) + 1;
        if (tries < MAX_ATTEMPTS) {
          this.attempts.set(evt.id, tries);
          return "retry";
        }
        this.attempts.delete(evt.id);
        const message = `Forwarding failed ${MAX_ATTEMPTS} times while your local server was up. Last error: ${outcome.message}`;
        return await this.settle(evt, terminal(message, outcome.latencyMs)) ? "next" : "retry";
      }
    }
  }
  /** Report an answer; on success the event is done, otherwise it is owed. */
  async settle(evt, answer) {
    const sleep = this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < REPORT_ATTEMPTS; i++) {
      try {
        await this.deps.report(evt, answer.result);
        this.unreported.delete(evt.id);
        this.handled.add(evt.id);
        if (answer.skipped) this.deps.onSkipped?.(evt, answer.skipped);
        else this.deps.onDelivered?.(evt, answer.result);
        return true;
      } catch {
        if (i < REPORT_ATTEMPTS - 1) await sleep(500 * 3 ** i);
      }
    }
    this.unreported.set(evt.id, answer);
    return false;
  }
  setLocalhost(state, message) {
    if (state === this.localhost && state === "ok") return;
    this.localhost = state;
    this.deps.onLocalhost?.(state, message);
  }
}
function terminal(message, latencyMs) {
  return {
    result: { status: 0, headers: {}, body: `BridgeHook: ${message}`, latencyMs },
    skipped: message
  };
}
export {
  CLAIM_HEARTBEAT_MS,
  MAX_ATTEMPTS,
  QueueDrainer,
  REPORT_ATTEMPTS
};
