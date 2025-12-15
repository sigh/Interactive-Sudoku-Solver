import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getRegisteredBenches, printBenchResult, runBench } from './bench_harness.js';

const benchesDirUrl = new URL('.', import.meta.url);
const benchesDirPath = fileURLToPath(benchesDirUrl);

const parseArgs = (argv) => {
  const args = { file: null, name: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--file') {
      args.file = argv[++i] ?? '';
    } else if (a.startsWith('--file=')) {
      args.file = a.slice('--file='.length);
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

const findBenches = async (dir, relativePath = '') => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await findBenches(join(dir, entry.name), join(relativePath, entry.name)));
    } else if (entry.name.endsWith('.bench.js')) {
      files.push(join(relativePath, entry.name));
    }
  }
  return files;
};

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: node tests/bench/run_all_benchmarks.js [--file <substring>] [--name <substring|/regex/>]');
  console.log('');
  console.log('Examples:');
  console.log('  node tests/bench/run_all_benchmarks.js --file util');
  console.log('  node tests/bench/run_all_benchmarks.js --file lookup_tables');
  console.log("  node tests/bench/run_all_benchmarks.js --name 'BitSet'");
  console.log("  node tests/bench/run_all_benchmarks.js --name '/^util::base64/'");
  process.exit(0);
}

let benchFiles = (await findBenches(benchesDirPath)).sort();
if (args.file) {
  const needle = String(args.file).toLowerCase();
  benchFiles = benchFiles.filter((p) => p.toLowerCase().includes(needle));
}
if (benchFiles.length === 0) {
  console.warn('No benchmark files (*.bench.js) found under tests/bench/.');
  process.exit(0);
}

console.log(`▶ Discovered ${benchFiles.length} benchmark file(s)`);

for (const benchFile of benchFiles) {
  await import(pathToFileURL(join(benchesDirPath, benchFile)));
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

console.log(`\n▶ Running ${benches.length} benchmark(s)`);

// Stable ordering for diffs.
benches.sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));

for (const b of benches) {
  const result = await runBench(b);
  printBenchResult(b, result);
}

console.log('\n✓ Benchmarks completed');
