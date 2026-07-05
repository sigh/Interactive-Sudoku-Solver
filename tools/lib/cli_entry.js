import { pathToFileURL } from 'node:url';

// Run a CLI's `main(process.argv)` only when its module is the program entry
// point — not when it is imported (e.g. by a test running the tool in-process).
// On a thrown error, print a clean message and exit non-zero. Tools therefore
// throw on failure rather than calling process.exit, so they stay testable
// without spawning a subprocess.
export const runAsCli = (importMetaUrl, main) => {
  if (!process.argv[1] || importMetaUrl !== pathToFileURL(process.argv[1]).href) return;
  try {
    main(process.argv);
  } catch (e) {
    console.error(`error: ${e.message}\n(run with --help for usage)`);
    process.exit(1);
  }
};
