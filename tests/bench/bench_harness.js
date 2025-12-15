import { pathToFileURL } from 'node:url';

const nowNs = () => process.hrtime.bigint();

const formatNumber = (value) => value.toLocaleString('en-US');

const formatSmall = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

const formatPerOpNs = (ns) => {
  if (!Number.isFinite(ns) || ns < 0) return 'n/a';
  if (ns === 0) return '0 ns';

  if (ns < 1000) return `${formatSmall(ns)} ns`;
  if (ns < 1e6) return `${formatSmall(ns / 1e3)} µs`;
  if (ns < 1e9) return `${formatSmall(ns / 1e6)} ms`;
  return `${formatSmall(ns / 1e9)} s`;
};

const formatOpsPerSec = (opsPerSec) => {
  if (!Number.isFinite(opsPerSec) || opsPerSec <= 0) return 'n/a';
  if (opsPerSec >= 1e9) return `${(opsPerSec / 1e9).toFixed(2)} Gops/s`;
  if (opsPerSec >= 1e6) return `${(opsPerSec / 1e6).toFixed(2)} Mops/s`;
  if (opsPerSec >= 1e3) return `${(opsPerSec / 1e3).toFixed(2)} Kops/s`;
  return `${opsPerSec.toFixed(2)} ops/s`;
};

export const DEFAULT_BENCH_OPTIONS = Object.freeze({
  warmupIterations: 5,
  iterations: 10,
  innerIterations: 50_000,
  minSampleTimeMs: 10,
});

const parseArgs = (argv) => {
  const args = { name: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--name') {
      args.name = argv[++i] ?? '';
    } else if (a.startsWith('--name=')) {
      args.name = a.slice('--name='.length);
    }
  }
  return args;
};

const toNameMatcher = (nameArg) => {
  if (!nameArg) return null;
  const trimmed = String(nameArg).trim();
  if (!trimmed) return null;

  // Support /regex/flags in addition to substring matching.
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1);
    try {
      const re = new RegExp(pattern, flags);
      return (s) => re.test(s);
    } catch {
      // Fall back to substring match on invalid regex.
    }
  }

  const needle = trimmed.toLowerCase();
  return (s) => s.toLowerCase().includes(needle);
};

/**
 * Registry is module-global so `run_all_benchmarks.js` can discover results.
 */
const registry = [];
let currentGroup = null;

export const benchGroup = (name, fn) => {
  const prev = currentGroup;
  currentGroup = name;
  try {
    fn();
  } finally {
    currentGroup = prev;
  }
};

export const bench = (name, fn, options = {}) => {
  registry.push({
    group: currentGroup || 'default',
    name,
    fn,
    options: { ...DEFAULT_BENCH_OPTIONS, ...options },
  });
};

export const getRegisteredBenches = () => registry.slice();

const maybeGc = () => {
  // Works only if node is run with `--expose-gc`.
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
};

const measureOnceNs = (fn, innerIterations) => {
  const start = nowNs();
  for (let i = 0; i < innerIterations; i++) fn();
  const end = nowNs();
  return Number(end - start);
};

const median = (arr) => {
  const xs = arr.slice().sort((a, b) => a - b);
  const mid = (xs.length / 2) | 0;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

export const runBench = async (b) => {
  const { fn, options } = b;
  const {
    warmupIterations,
    iterations,
    innerIterations,
    minSampleTimeMs,
  } = options;

  // Warmup (JIT + caches).
  for (let i = 0; i < warmupIterations; i++) {
    measureOnceNs(fn, Math.min(1_000, innerIterations));
  }

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    maybeGc();

    // Ensure each sample is long enough to reduce timer noise.
    let usedInner = innerIterations;
    const minSampleTimeNs = minSampleTimeMs * 1e6;
    let elapsedNs = measureOnceNs(fn, usedInner);
    while (elapsedNs < minSampleTimeNs) {
      usedInner = Math.min(usedInner * 2, 50_000_000);
      elapsedNs = measureOnceNs(fn, usedInner);
    }

    samples.push({ ns: elapsedNs, innerIterations: usedInner });
  }

  const perOpNs = samples.map((s) => s.ns / s.innerIterations);
  const medPerOpNs = median(perOpNs);
  const opsPerSec = 1e9 / medPerOpNs;

  return {
    samples,
    medianPerOpNs: medPerOpNs,
    opsPerSec,
  };
};

export const printBenchResult = (b, result) => {
  const label = `${b.group} :: ${b.name}`;
  const perOp = result.medianPerOpNs;

  // Display an approximate per-op time; note that the loop overhead is included.
  const perOpDisplay = formatPerOpNs(perOp);
  const opsDisplay = formatOpsPerSec(result.opsPerSec);
  const sampleCount = result.samples.length;
  const inner = formatNumber(result.samples[0]?.innerIterations ?? 0);

  console.log(`${label}`);
  console.log(`  median/op: ${perOpDisplay} | throughput: ${opsDisplay} | samples: ${sampleCount} | inner: ${inner}`);
};

export const isMain = (importMetaUrl, argv = process.argv) => {
  const mainPath = argv?.[1];
  if (!mainPath) return false;
  try {
    return pathToFileURL(mainPath).href === importMetaUrl;
  } catch {
    return false;
  }
};

export const runIfMain = async (importMetaUrl, argv = process.argv) => {
  if (!isMain(importMetaUrl, argv)) return;

  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node <file>.bench.js [--name <substring|/regex/>]');
    process.exit(0);
  }

  let benches = getRegisteredBenches();
  if (benches.length === 0) {
    console.warn('No benchmarks registered.');
    process.exit(0);
  }

  const nameMatches = toNameMatcher(args.name);
  if (nameMatches) {
    benches = benches.filter((b) => nameMatches(`${b.group} :: ${b.name}`));
  }

  if (benches.length === 0) {
    console.warn('No benchmarks matched the provided filters.');
    process.exit(0);
  }

  console.log(`▶ Running ${benches.length} benchmark(s)`);

  benches.sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));
  for (const b of benches) {
    const result = await runBench(b);
    printBenchResult(b, result);
  }

  console.log('\n✓ Benchmarks completed');
};
