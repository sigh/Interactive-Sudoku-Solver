
self.VERSION_PARAM = self.location.search;

// Preload modules.
const modulesPromise = (async () => {
  try {
    const { SudokuConstraint } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
    const { SudokuParser } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
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

const compileStateMachine = ({ SudokuConstraint }, { spec, numValues, numCells, isUnified }) => {
  let parsedSpec;
  if (isUnified) {
    parsedSpec = new Function('NUM_CELLS', `let maxDepth; ${spec}\nreturn {startState, transition, accept, maxDepth };`)(numCells);
  } else {
    const { startExpression, transitionBody, acceptBody, maxDepthExpression } = spec;
    const startState = new Function('NUM_CELLS', '"use strict"; return (' + startExpression + '\n);')(numCells);
    const transition = new Function('state', 'value', 'NUM_CELLS', transitionBody);
    const accept = new Function('state', 'NUM_CELLS', acceptBody);
    const maxDepth = maxDepthExpression
      ? new Function('NUM_CELLS', '"use strict"; return (' + maxDepthExpression + '\n);')(numCells)
      : Infinity;
    parsedSpec = {
      startState,
      transition: (s, v) => transition(s, v, numCells),
      accept: (s) => accept(s, numCells),
      maxDepth,
    };
  }

  // Default maxDepth to Infinity.
  parsedSpec.maxDepth = parsedSpec.maxDepth || Infinity;

  return SudokuConstraint.NFA.encodeSpec(parsedSpec, numValues);
}

const convertUnifiedToSplit = ({ code }) => {
  const parsed = new Function(`let maxDepth; ${code}\nreturn {startState, transition, accept, maxDepth};`)();

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
    maxDepthExpression: parsed.maxDepth ? String(parsed.maxDepth) : ''
  };
}

let sandboxEnvPromise;

const runSandboxCode = async ({ SudokuConstraint, SudokuParser }, { code, currentConstraintStr, id }) => {
  if (!sandboxEnvPromise) {
    sandboxEnvPromise = import('./sandbox/env.js' + self.VERSION_PARAM);
  }
  const { SANDBOX_GLOBALS, withSandboxConsole, getSandboxExtraGlobals } = await sandboxEnvPromise;

  const emit = (msg) => self.postMessage({ id, ...msg });

  return withSandboxConsole(emit, async () => {
    const extraGlobals = getSandboxExtraGlobals(currentConstraintStr);
    const allGlobals = { ...SANDBOX_GLOBALS, ...extraGlobals };
    const keys = Object.keys(allGlobals);
    const values = Object.values(allGlobals);
    const asyncFn = new Function(...keys, `return (async () => { ${code}\n })();`);
    const result = await asyncFn(...values);

    let constraintStr = null;
    if (result) {
      if (Array.isArray(result)) {
        const parsed = result.map(item =>
          typeof item === 'string' ? SudokuParser.parseString(item) : item
        );
        constraintStr = String(new SudokuConstraint.Container(parsed));
      } else {
        constraintStr = String(result);
      }
    }

    return { constraintStr };
  });
}
