
self.VERSION_PARAM = self.location.search;

// Preload modules.
const modulesPromise = (async () => {
  try {
    const [
      { SudokuConstraint },
      { SudokuParser },
    ] = await Promise.all([
      import('./sudoku_constraint.js' + self.VERSION_PARAM),
      import('./sudoku_parser.js' + self.VERSION_PARAM),
    ]);
    self.postMessage({ type: 'ready' });
    return { SudokuConstraint, SudokuParser };
  } catch (e) {
    self.postMessage({ type: 'initError', error: e.message || String(e) });
    throw e;
  }
})();

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    const modules = await modulesPromise;
    let result;
    switch (type) {
      case 'compilePairwise':
        result = compilePairwise(modules, payload);
        break;
      case 'compileStateMachine':
        result = compileStateMachine(modules, payload);
        break;
      case 'convertUnifiedToSplit':
        result = convertUnifiedToSplit(payload);
        break;
      case 'runSandboxCode':
        result = await runSandboxCode(modules, payload);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    self.postMessage({ id, result });
  } catch (error) {
    // If the error object has logs, include them in the response.
    const response = { id, error: error.message || String(error) };
    if (error.logs) response.logs = error.logs;
    self.postMessage(response);
  }
};

const compilePairwise = ({ SudokuConstraint }, { type, fnStr, numValues }) => {
  const typeCls = SudokuConstraint[type];
  if (!typeCls) throw new Error(`Unknown constraint type: ${type}`);

  const fn = new Function(`return ((a,b)=>${fnStr})`)();
  return typeCls.fnToKey(fn, numValues);
}

const compileStateMachine = ({ SudokuConstraint }, { spec, numValues, isUnified }) => {
  let parsedSpec;
  if (isUnified) {
    parsedSpec = new Function(`${spec}; return {startState, transition, accept};`)();
  } else {
    const { startExpression, transitionBody, acceptBody } = spec;
    const startState = new Function('"use strict"; return (' + startExpression + ');')();
    const transition = new Function('state', 'value', transitionBody);
    const accept = new Function('state', acceptBody);
    parsedSpec = { startState, transition, accept };
  }

  return SudokuConstraint.NFA.encodeSpec(parsedSpec, numValues);
}

const convertUnifiedToSplit = ({ code }) => {
  const parsed = new Function(`${code}; return {startState, transition, accept};`)();

  const extractFunctionBody = (fn) => {
    const source = fn.toString();
    const start = source.indexOf('{\n') + 2;
    const end = source.lastIndexOf('\n}');
    return source.slice(start, end).replace(/^ {2}/gm, '');
  };

  return {
    startExpression: JSON.stringify(parsed.startState),
    transitionBody: extractFunctionBody(parsed.transition),
    acceptBody: extractFunctionBody(parsed.accept),
  };
}

let sandboxEnvPromise;

const runSandboxCode = async ({ SudokuConstraint, SudokuParser }, { code }) => {
  if (!sandboxEnvPromise) {
    sandboxEnvPromise = import('./sandbox/env.js' + self.VERSION_PARAM);
  }
  const { SANDBOX_GLOBALS } = await sandboxEnvPromise;

  const logs = [];
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };

  const formatArg = (a) =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a);

  console.log = (...args) => logs.push(args.map(formatArg).join(' '));
  console.error = (...args) => logs.push('ERROR: ' + args.map(formatArg).join(' '));
  console.warn = (...args) => logs.push('WARN: ' + args.map(formatArg).join(' '));

  try {
    const keys = Object.keys(SANDBOX_GLOBALS);
    const values = Object.values(SANDBOX_GLOBALS);
    const asyncFn = new Function(...keys, `return (async () => { ${code} })();`);
    const result = await asyncFn(...values);

    let constraintStr = '';
    if (result) {
      if (Array.isArray(result)) {
        const parsed = result.map(item =>
          typeof item === 'string' ? SudokuParser.parseString(item) : item
        );
        constraintStr = String(new SudokuConstraint.Set(parsed));
      } else {
        constraintStr = String(result);
      }
    }

    return { constraintStr, logs };
  } catch (e) {
    // If an error occurs, we still want to return the logs.
    throw { message: e.message || String(e), logs };
  } finally {
    Object.assign(console, originalConsole);
  }
}
