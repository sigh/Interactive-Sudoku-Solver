// estimator_strategies.js — pluggable solution-count estimators for the
// estimator lab (tools/perf/estimator_lab.js). Research code: every strategy
// here is an unbiased estimator of the solution count, built from the same
// engine primitives as the production Knuth sampler
// (SamplingCandidateSelector in js/solver/candidate_selector.js), so results
// transfer directly. `base` is plain Knuth sampling. The production
// estimator (js/solver/ESTIMATION.md) is not a strategy here: it derives
// its tail depth from its own size statistics and grows its budget over the
// run, so drive it through InternalSolver.estimatedCountSolutions(maxSamples,
// seed) when comparing against these.
//
// A strategy is a plain options object (see STRATEGIES) interpreted by
// LabSelector, or a named runner registered in RUNNERS:
//
//   cell:      'engine' | 'mincount' | 'random'   cell-selection policy
//   lookahead: propagate every child of the chosen cell, sample only among
//              the survivors (weight = number of survivors)
//   is:        'domain' | 'cells' — importance-sample children by a
//              sub-tree-size proxy (needs lookahead); alpha = exponent,
//              floor = uniform mixing fraction
//   tailG/tailT/tailL: "exact tails" — after tailG random guesses (or once
//              log2 of the product of domain sizes drops to tailT), count the
//              remaining sub-tree exactly under a cap of tailL backtracks; if
//              the cap is hit, resume sampling from that state. Both trigger
//              rules are functions of the state alone, so the estimator stays
//              unbiased.
//   tree:      adaptive prefix tree (top-level stratification), see TreeSelector
//   bdfs:      budgeted-DFS Knuth (Knuth's estimator on the coarsened tree
//              whose nodes are capped depth-first searches), see runBdfs
//
// Every runner returns { mean, hits, us, maxShare, stats } for one seeded run.

import { buildSolver } from './puzzle_runner.js';

const { CandidateSelector } = await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);
const { RandomIntGenerator, countOnes16bit } = await import('../../js/util.js' + self.VERSION_PARAM);

export const STRATEGIES = {
  // Plain Knuth sampling: engine cell policy, uniform value, one path.
  base: { cell: 'engine' },
  mincount: { cell: 'mincount' },
  random: { cell: 'random' },
  la: { cell: 'engine', lookahead: true },
  'la-mincount': { cell: 'mincount', lookahead: true },
  'la-is-dom': { cell: 'engine', lookahead: true, is: 'domain', alpha: 1, floor: 0.1 },
  'la-is-dom.5': { cell: 'engine', lookahead: true, is: 'domain', alpha: 0.5, floor: 0.1 },
  'la-is-cells': { cell: 'engine', lookahead: true, is: 'cells', alpha: 1, floor: 0.1 },
  // Exact tails by guess depth / by domain-size threshold.
  'g4-L2k': { cell: 'engine', tailG: 4, tailL: 2000 },
  'g6-L2k': { cell: 'engine', tailG: 6, tailL: 2000 },
  'g8-L2k': { cell: 'engine', tailG: 8, tailL: 2000 },
  'g8-L20k': { cell: 'engine', tailG: 8, tailL: 20000 },
  'tail40-L2k': { cell: 'engine', tailT: 40, tailL: 2000 },
  'tail60-L500': { cell: 'engine', tailT: 60, tailL: 500 },
  // Adaptive prefix tree (ratio = target samples per frontier node).
  at: { cell: 'engine', tree: true, V: 4, ratio: 20, alloc: 'leaf' },
  'at-r5': { cell: 'engine', tree: true, V: 4, ratio: 5, alloc: 'leaf' },
  'at-sib': { cell: 'engine', tree: true, V: 4, ratio: 20, alloc: 'sibling' },
  // First complete sub-tree (the rolled-back Nov 2025 design; B = budget).
  'fcs-B16': { fcs: true, B: 16 },
  'fcs-B64': { fcs: true, B: 64 },
  'fcs-B256': { fcs: true, B: 256 },
  'fcs-B1024': { fcs: true, B: 1024 },
  // Budgeted-DFS Knuth (L = backtrack budget per DFS).
  'bdfs-L50': { bdfs: true, L: 50 },
  'bdfs-L200': { bdfs: true, L: 200 },
  'bdfs-L1000': { bdfs: true, L: 1000 },
};

// Parse "name" or "name:key=value,key=value" (numeric values) so one-off
// variants need no code change, e.g. "g6-L2k:tailL=500".
export const resolveStrategy = (spec) => {
  const [name, params] = spec.split(':');
  const base = STRATEGIES[name];
  if (!base) throw new Error(`unknown strategy "${name}" (known: ${Object.keys(STRATEGIES).join(', ')})`);
  const opts = { ...base };
  if (params) {
    for (const kv of params.split(',')) {
      const [k, v] = kv.split('=');
      opts[k] = Number.isNaN(+v) ? v : +v;
    }
  }
  return opts;
};

const log2DomainProduct = (gridState, numSearchCells) => {
  let s = 0;
  for (let i = 0; i < numSearchCells; i++) {
    const v = gridState[i];
    if (v & (v - 1)) s += Math.log2(countOnes16bit(v));
  }
  return s;
};

// A sampling candidate selector with pluggable cell policy, optional
// lookahead / importance sampling, and the exact-tail hand-off.
export class LabSelector extends CandidateSelector {
  constructor(internal, options, seed) {
    super(internal._geometry, internal._numSearchCells, internal._handlerSet, internal._debugLogger);
    this._internal = internal;
    this._opts = options;
    this._rnd = new RandomIntGenerator(seed);
    this._totalWeight = new Float64Array(this._numSearchCells + 1);
    this._totalWeight[0] = 1.0;
    this._scratch = new Uint16Array(internal._initialGridState.length);
    this._childBuf = [];
    this.stats = { lookaheadProps: 0, tails: 0, tailExact: 0, tailBacktracks: 0 };
    // Exact-tail hand-off state, driven by runEstimator.
    this.tailArmed = options.tailT !== undefined || options.tailG !== undefined;
    this.tailState = null;
    this.tailWeight = 1;
    this.guesses = 0;
  }

  _uniform() { return this._rnd._next() / 4294967296; }

  getSolutionWeight() { return this._totalWeight[this._numSearchCells]; }

  _chooseCell(gridState, cellOrder, cellDepth) {
    const opts = this._opts;
    const n = this._numSearchCells;
    if (opts.cell === 'engine') {
      return this._selectBestCell(gridState, cellOrder, cellDepth).cellOffset;
    }
    if (opts.cell === 'mincount') {
      let best = cellDepth, bestCount = Infinity;
      for (let i = cellDepth; i < n; i++) {
        const c = countOnes16bit(gridState[cellOrder[i]]);
        if (c < bestCount) { bestCount = c; best = i; if (c <= 1) break; }
      }
      return best;
    }
    // 'random': a forced single anywhere takes precedence, like the engine.
    for (let i = cellDepth; i < n; i++) {
      const v = gridState[cellOrder[i]];
      if ((v & (v - 1)) === 0) return i;
    }
    return cellDepth + this._rnd.randomInt(n - cellDepth - 1);
  }

  // Sub-tree-size proxy for importance sampling (log2 domain product, or
  // number of unfixed cells).
  _childScore(state) {
    const n = this._numSearchCells;
    if (this._opts.is === 'cells') {
      let unfixed = 0;
      for (let i = 0; i < n; i++) { const v = state[i]; if (v & (v - 1)) unfixed++; }
      return unfixed;
    }
    return log2DomainProduct(state, n);
  }

  // Returns [value, weightMultiplier, count], or null if no child survives.
  _chooseValue(cell, values, count, gridState) {
    const opts = this._opts;
    if (!opts.lookahead) {
      let n = this._rnd.randomInt(count - 1);
      let v = values;
      while (n--) v &= v - 1;
      return [v & -v, count, count];
    }
    const internal = this._internal;
    const pQueue = internal._propagationQueue;
    const scratch = this._scratch;
    const vals = this._childBuf; vals.length = 0;
    const scores = [];
    let rest = values;
    while (rest) {
      const v = rest & -rest; rest ^= v;
      scratch.set(gridState);
      scratch[cell] = v;
      pQueue.reset(false);
      pQueue.addForFixedCell(cell);
      this.stats.lookaheadProps++;
      if (internal._enforceConstraints(scratch, pQueue)) {
        vals.push(v);
        if (opts.is) scores.push(this._childScore(scratch));
      }
    }
    pQueue.reset(false);
    const k = vals.length;
    if (k === 0) return null;
    if (!opts.is || k === 1) return [vals[this._rnd.randomInt(k - 1)], k, k];
    // p_i = floor/k + (1-floor) * 2^(alpha*score_i) / sum
    const maxS = Math.max(...scores);
    const ws = scores.map(s => Math.pow(2, opts.alpha * (s - maxS)));
    const sum = ws.reduce((a, b) => a + b, 0);
    const probs = ws.map(w => opts.floor / k + (1 - opts.floor) * w / sum);
    let r = this._uniform();
    let i = 0;
    for (; i < k - 1; i++) { r -= probs[i]; if (r < 0) break; }
    return [vals[i], 1 / probs[i], k];
  }

  _tailTriggered(gridState) {
    const { tailG, tailT } = this._opts;
    if (!this.tailArmed) return false;
    if (tailG !== undefined && this.guesses >= tailG) return true;
    return tailT !== undefined && log2DomainProduct(gridState, this._numSearchCells) <= tailT;
  }

  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    const result = CandidateSelector._selectNextCandidateResult;
    result.nextDepth = 0; result.value = 0; result.count = 0;
    if (!isNewNode) return result;
    const cellOrder = this._cellOrder;
    let cellOffset, value, count, mult = 1;
    const firstValue = gridState[cellOrder[cellDepth]];
    if ((firstValue & (firstValue - 1)) === 0) {
      cellOffset = cellDepth; value = firstValue; count = firstValue ? 1 : 0;
    } else {
      cellOffset = this._chooseCell(gridState, cellOrder, cellDepth);
      const cell = cellOrder[cellOffset];
      const values = gridState[cell];
      count = countOnes16bit(values);
      if (count <= 1) {
        value = values;
      } else {
        if (this._tailTriggered(gridState)) {
          // Hand the sub-tree to the exact counter by aborting this run.
          this.tailState = gridState.slice();
          this.tailWeight = this._totalWeight[cellDepth];
          return result;
        }
        const choice = this._chooseValue(cell, values, count, gridState);
        if (choice === null) return result;
        this.guesses++;
        [value, mult, count] = choice;
      }
    }
    if (count === 0) return result;
    const nextDepth = this._updateCellOrder(cellDepth, cellOffset, count, gridState);
    if (nextDepth === 0) return result;
    this._totalWeight[nextDepth] = this._totalWeight[cellDepth] * mult;
    result.nextDepth = nextDepth; result.value = value; result.count = count;
    return result;
  }
}

// One Knuth-style path from the solver's current initial state. Returns the
// sample weight (0 for a contradiction), or null if the selector handed off
// to an exact tail (sel.tailState / sel.tailWeight are then set).
const samplePath = (internal, sel) => {
  internal._resetRun();
  sel.tailState = null; sel.guesses = 0;
  let found = false;
  // counters.backtracks is cumulative across runs, so the cap is relative.
  internal.run({ maxBacktracks: internal.counters.backtracks + 1 }, () => { found = true; });
  if (sel.tailState !== null) return null;
  return found ? sel.getSolutionWeight() : 0;
};

// Exact count from `state`, capped. Returns { count, exhausted, backtracks }.
const cappedCount = (internal, exactSel, state, cap) => {
  const sel = internal._candidateSelector;
  internal._initialGridState = state;
  internal._candidateSelector = exactSel;
  internal._resetRun();
  const bt0 = internal.counters.backtracks;
  let count = 0;
  internal.run({ maxBacktracks: cap ? bt0 + cap : 0 }, () => { count++; });
  internal._candidateSelector = sel;
  return {
    count,
    exhausted: internal.state === internal.constructor.STATE_EXHAUSTED,
    backtracks: internal.counters.backtracks - bt0,
  };
};

const summarize = (values, numSamples, ms, stats) => {
  let sum = 0, hits = 0, maxW = 0;
  for (const w of values) { sum += w; if (w > 0) { hits++; if (w > maxW) maxW = w; } }
  return { mean: sum / numSamples, hits, us: ms * 1000 / numSamples, maxShare: sum ? maxW / sum : 0, stats };
};

// Path sampler with optional exact tails.
export const runEstimator = (input, opts, seed, numSamples) => {
  const { internal } = buildSolver(input);
  const sel = new LabSelector(internal, opts, seed);
  const exactSel = internal._candidateSelector;
  internal._candidateSelector = sel;
  const rootState = internal._initialGridState;
  const values = [];
  const t0 = performance.now();
  for (let i = 0; i < numSamples; i++) {
    let w = 1;
    sel.tailArmed = opts.tailT !== undefined || opts.tailG !== undefined;
    for (;;) {
      const pathWeight = samplePath(internal, sel);
      if (pathWeight !== null) { w *= pathWeight; break; }
      sel.stats.tails++;
      w *= sel.tailWeight;
      const tail = cappedCount(internal, exactSel, sel.tailState, opts.tailL);
      sel.stats.tailBacktracks += tail.backtracks;
      if (tail.exhausted) { sel.stats.tailExact++; w *= tail.count; break; }
      // Cap hit: resume sampling from the tail state, no further tails.
      sel.tailArmed = false;
    }
    internal._initialGridState = rootState;
    values.push(w);
  }
  return summarize(values, numSamples, performance.now() - t0, sel.stats);
};

// ---------------------------------------------------------------------------
// Adaptive prefix tree (top-level stratification grown out of the samples).
// Each sample walks the expanded tree (allocation policy), then Knuth-samples
// below the frontier node it lands on. Estimate = sum over frontier nodes of
// their sample means (exact values for deterministic sub-trees). A frontier
// node is expanded (children = propagation-surviving values of its branching
// cell) once it has V samples and the frontier is below samples/ratio; the
// samples that drove the expansion are discarded (expansion depends only on
// visit counts, so this stays unbiased).

class TreeNode {
  constructor(parent) {
    this.parent = parent;
    this.cell = -1;         // branching cell (set on first visit)
    this.state = null;      // grid state on first visit
    this.children = null;   // [{ value, node }] once expanded
    this.n = 0; this.sum = 0;
    this.visits = 0;        // samples routed through this sub-tree
    this.leaves = 1;        // live frontier nodes in this sub-tree
    this.exact = null;      // exact count when the sub-tree is deterministic
  }
  get mean() { return this.exact ?? (this.n ? this.sum / this.n : 0); }
}

export class TreeSelector extends LabSelector {
  constructor(internal, options, seed) {
    super(internal, options, seed);
    this.root = new TreeNode(null);
    this.frontier = new Set([this.root]);
    this.numNodes = 1;
    this.samples = 0;
    this._cur = null; this._sampleNode = null; this._randomChoices = 0;
  }

  beginSample() { this._cur = this.root; this._sampleNode = null; this._randomChoices = 0; }

  _pickChild(node) {
    const live = node.children.filter(c => c.node.exact === null);
    if (live.length === 0) return null;
    // 'leaf': equal samples per frontier node; 'sibling': equal per child.
    const score = this._opts.alloc === 'sibling'
      ? (c) => c.node.visits : (c) => c.node.visits / c.node.leaves;
    let best = live[0], bestScore = Infinity;
    for (const c of live) {
      const s = score(c);
      if (s < bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  _adjustLeaves(node, delta) {
    for (let a = node; a !== null; a = a.parent) a.leaves += delta;
  }

  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    const result = CandidateSelector._selectNextCandidateResult;
    result.nextDepth = 0; result.value = 0; result.count = 0;
    if (!isNewNode) return result;
    const cellOrder = this._cellOrder;
    const firstValue = gridState[cellOrder[cellDepth]];
    if ((firstValue & (firstValue - 1)) !== 0 && this._sampleNode === null) {
      const node = this._cur;
      if (node.children !== null) {
        // Replay a tree edge (weight multiplier 1: strata are summed).
        const pick = this._pickChild(node);
        if (pick === null) {
          node.exact = node.children.reduce((a, c) => a + c.node.exact, 0);
          this._adjustLeaves(node, -node.leaves);
          return result;
        }
        const cellOffset = cellOrder.indexOf(node.cell, cellDepth);
        if (cellOffset < 0) throw new Error('tree cell already fixed on replay');
        const nextDepth = this._updateCellOrder(cellDepth, cellOffset, node.children.length, gridState);
        this._totalWeight[nextDepth] = this._totalWeight[cellDepth];
        this._cur = pick.node;
        result.nextDepth = nextDepth; result.value = pick.value; result.count = node.children.length;
        return result;
      }
      // Frontier: remember state/cell on first visit, then sample below.
      this._sampleNode = node;
      if (node.state === null) {
        node.state = gridState.slice();
        node.cell = cellOrder[this._chooseCell(gridState, cellOrder, cellDepth)];
      }
    }
    const r = super.selectNextCandidate(cellDepth, gridState, stepState, isNewNode);
    if (r.count > 1) this._randomChoices++;
    return r;
  }

  endSample(found) {
    this.samples++;
    const node = this._sampleNode ?? this._cur;
    const w = found ? this.getSolutionWeight() : 0;
    for (let a = node; a !== null; a = a.parent) a.visits++;
    if (node.children !== null) return;  // died replaying into an exact sub-tree
    if (this._randomChoices === 0) {
      node.exact = w;  // no random choice was made: the sub-tree is deterministic
      this._adjustLeaves(node, -1);
      return;
    }
    node.n++; node.sum += w;
    const opts = this._opts;
    if (node.n >= opts.V && this.frontier.size < this.samples / opts.ratio) this._expand(node);
  }

  _expand(node) {
    const internal = this._internal;
    const pQueue = internal._propagationQueue;
    const scratch = this._scratch;
    const children = [];
    let rest = node.state[node.cell];
    while (rest) {
      const v = rest & -rest; rest ^= v;
      scratch.set(node.state); scratch[node.cell] = v;
      pQueue.reset(false); pQueue.addForFixedCell(node.cell);
      if (internal._enforceConstraints(scratch, pQueue)) {
        children.push({ value: v, node: new TreeNode(node) });
      }
    }
    pQueue.reset(false);
    node.children = children;
    node.n = 0; node.sum = 0;
    this.frontier.delete(node);
    for (const c of children) this.frontier.add(c.node);
    this.numNodes += children.length;
    if (children.length === 0) node.exact = 0;
    this._adjustLeaves(node, children.length - 1);
  }

  estimate() {
    let total = 0;
    for (const f of this.frontier) total += f.mean;
    return total;
  }
}

export const runTreeEstimator = (input, opts, seed, numSamples) => {
  const { internal } = buildSolver(input);
  const sel = new TreeSelector(internal, opts, seed);
  internal._candidateSelector = sel;
  let hits = 0;
  const t0 = performance.now();
  for (let i = 0; i < numSamples; i++) {
    internal._resetRun();
    sel.beginSample();
    let found = false;
    internal.run({ maxBacktracks: internal.counters.backtracks + 1 }, () => { found = true; });
    if (found) hits++;
    sel.endSample(found);
  }
  const ms = performance.now() - t0;
  const stats = { ...sel.stats, nodes: sel.numNodes, frontier: sel.frontier.size };
  return { mean: sel.estimate(), hits, us: ms * 1000 / numSamples, maxShare: 0, stats };
};

// ---------------------------------------------------------------------------
// Budgeted-DFS Knuth. A "node" is a depth-first search from a state with a
// backtrack budget L; its "children" are the sub-trees still pending on the
// DFS stack when the budget runs out. Knuth's estimator on that coarsened
// tree: value(S) = found(S) + m(S) * value(random pending child). A tree that
// fits in L is counted exactly. The root DFS is memoized (it is identical for
// every sample).

// The exact selector for budgeted DFS: plain lowest-value branching (no
// house/digit custom candidates, so every pending sub-tree is a (cell, value)
// branch), recording the last branch count so the interrupted frame can be
// classified (see budgetedDfs).
class RecordingSelector extends CandidateSelector {
  constructor(internal) {
    super(internal._geometry, internal._numSearchCells, internal._handlerSet, internal._debugLogger);
    this._optionSelector = { selectValue: (values) => values & -values };
    this.lastCount = 0;
  }
  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    const r = super.selectNextCandidate(cellDepth, gridState, stepState, isNewNode);
    this.lastCount = r.count;
    return r;
  }
}

const budgetedDfs = (internal, state, L, stats) => {
  internal._initialGridState = state;
  internal._resetRun();
  const bt0 = internal.counters.backtracks;
  let found = 0;
  internal.run({ maxBacktracks: bt0 + L }, () => { found++; });
  stats.tailBacktracks += internal.counters.backtracks - bt0;
  stats.tails++;
  if (internal.state === internal.constructor.STATE_EXHAUSTED) {
    stats.tailExact++;
    return { found, exhausted: true, pending: [], m: 0 };
  }
  // The DFS path is recStack[0..top]; each frame's grid holds the values not
  // yet tried at its branching cell. When the last step was a forced value
  // (count 1) the interrupted frame is a fully processed leaf, not a pending
  // parent, so it is excluded.
  const recStack = internal._recStack;
  const sel = internal._candidateSelector;
  const top = recStack.indexOf(internal._currentRecFrame) - (sel.lastCount === 1 ? 1 : 0);
  const cellOrder = sel.getCellOrder();
  const pending = [];
  let m = 0;
  for (let k = 0; k <= top; k++) {
    const frame = recStack[k];
    const cell = cellOrder[frame.cellDepth];
    const values = frame.gridCells[cell];
    const count = countOnes16bit(values);
    if (count === 0) continue;
    pending.push({ state: frame.gridState.slice(), cell, values, count });
    m += count;
  }
  // The cap can land on the very last leaf: nothing pending means exhausted.
  return { found, exhausted: m === 0, pending, m };
};

const pickPending = (rnd, node) => {
  let r = rnd.randomInt(node.m - 1);
  for (const p of node.pending) {
    if (r < p.count) {
      let v = p.values;
      while (r--) v &= v - 1;
      const s = p.state.slice();
      s[p.cell] = v & -v;
      return s;
    }
    r -= p.count;
  }
  throw new Error('unreachable');
};

export const runBdfs = (input, opts, seed, numSamples) => {
  const { internal } = buildSolver(input);
  internal._candidateSelector = new RecordingSelector(internal);
  const rnd = new RandomIntGenerator(seed);
  const rootState = internal._initialGridState;
  const stats = { tails: 0, tailExact: 0, tailBacktracks: 0 };
  let rootNode = null;
  const values = [];
  const t0 = performance.now();
  for (let i = 0; i < numSamples; i++) {
    let node = rootNode ??= budgetedDfs(internal, rootState.slice(), opts.L, stats);
    let w = 1, value = node.found;
    while (!node.exhausted) {
      w *= node.m;
      node = budgetedDfs(internal, pickPending(rnd, node), opts.L, stats);
      value += w * node.found;
    }
    values.push(value);
  }
  internal._initialGridState = rootState;
  return summarize(values, numSamples, performance.now() - t0, stats);
};

// ---------------------------------------------------------------------------
// "First complete sub-tree" (the estimator shipped Nov 2025 and rolled back
// in "Simplify solution estimator"): descend a random path, then keep
// searching depth-first within a backtrack budget B; report Knuth weight x
// solutions for the largest sub-tree on the initial path that the search
// completed. The tail node is chosen by search cost, not by depth. Random
// value choice is switched off once the first leaf is done (the old
// FIRST_BRANCH_ONLY rule), so everything after the initial descent is the
// deterministic search. Custom (house/digit) candidates stay off here, which
// the old code did not guarantee.

class FirstCompleteSelector extends CandidateSelector {
  constructor(internal, seed) {
    super(internal._geometry, internal._numSearchCells, internal._handlerSet, internal._debugLogger);
    this._internal = internal;
    this._random = { rnd: new RandomIntGenerator(seed) };
    this._random.selectValue = (values, count) => {
      let n = this._random.rnd.randomInt(count - 1);
      while (n--) values &= values - 1;
      return values & -values;
    };
    this._weight = new Float64Array(this._numSearchCells + 1);
    this._childWeight = new Float64Array(this._numSearchCells + 1);
  }

  startSample() {
    this._optionSelector = this._random;
    this._weight[0] = 1;
    this._solutionsAtStart = this._internal.counters.solutions;
    this.best = null;  // { depth, weight, solutions } of the largest completed sub-tree
  }

  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    if (!isNewNode) {
      // Revisiting a frame: the sub-tree below its previous value completed.
      this._optionSelector = null;
      if (this.best === null || cellDepth < this.best.depth) {
        this.best = {
          depth: cellDepth,
          weight: this._childWeight[cellDepth],
          solutions: this._internal.counters.solutions - this._solutionsAtStart,
        };
      }
    }
    const r = super.selectNextCandidate(cellDepth, gridState, stepState, isNewNode);
    if (isNewNode && r.count > 0) {
      this._childWeight[cellDepth] = this._weight[cellDepth] * r.count;
      this._weight[r.nextDepth] = this._childWeight[cellDepth];
    }
    return r;
  }
}

export const runFirstComplete = (input, opts, seed, numSamples) => {
  const { internal } = buildSolver(input);
  const sel = new FirstCompleteSelector(internal, seed);
  internal._candidateSelector = sel;
  const stats = { tails: 0, tailExact: 0, tailBacktracks: 0 };
  const values = [];
  const t0 = performance.now();
  for (let i = 0; i < numSamples; i++) {
    internal._resetRun();
    sel.startSample();
    const bt0 = internal.counters.backtracks;
    const sol0 = internal.counters.solutions;
    internal.run({ maxBacktracks: bt0 + opts.B }, () => { });
    stats.tails++;
    stats.tailBacktracks += internal.counters.backtracks - bt0;
    if (internal.state === internal.constructor.STATE_EXHAUSTED) {
      stats.tailExact++;
      values.push(internal.counters.solutions - sol0);
    } else {
      values.push(sel.best === null ? 0 : sel.best.weight * sel.best.solutions);
    }
  }
  return summarize(values, numSamples, performance.now() - t0, stats);
};

export const runStrategy = (input, opts, seed, numSamples) => {
  if (opts.fcs) return runFirstComplete(input, opts, seed, numSamples);
  if (opts.tree) return runTreeEstimator(input, opts, seed, numSamples);
  if (opts.bdfs) return runBdfs(input, opts, seed, numSamples);
  return runEstimator(input, opts, seed, numSamples);
};
