// Lightweight stats container shared by sandbox tooling.
// Kept dependency-free so it can be imported cheaply.

export class SolverStats {
  constructor(state) {
    const counters = state?.counters || {};

    // Timing
    this.setupTimeMs = state?.puzzleSetupTime || 0;
    this.runtimeMs = state?.timeMs || 0;

    // Counters
    this.solutions = counters.solutions || 0;
    this.guesses = counters.guesses || 0;
    this.backtracks = counters.backtracks || 0;
    this.nodesSearched = counters.nodesSearched || 0;
    this.constraintsProcessed = counters.constraintsProcessed || 0;
    this.valuesTried = counters.valuesTried || 0;
    this.branchesIgnored = counters.branchesIgnored || 0;
  }

  add(other) {
    this.setupTimeMs += other.setupTimeMs;
    this.runtimeMs += other.runtimeMs;

    this.solutions += other.solutions;
    this.guesses += other.guesses;
    this.backtracks += other.backtracks;
    this.nodesSearched += other.nodesSearched;
    this.constraintsProcessed += other.constraintsProcessed;
    this.valuesTried += other.valuesTried;
    this.branchesIgnored += other.branchesIgnored;
    return this;
  }

  pick(...fields) {
    const out = {};
    for (const field of fields) {
      let value = this[field];
      if (typeof value === 'number' && /Ms$/.test(field)) {
        value = Math.round(value);
      }
      out[field] = value;
    }
    return out;
  }
}
