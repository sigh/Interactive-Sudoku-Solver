import { CodeJar } from '../../lib/codejar.min.js';
import { SudokuConstraint } from '../sudoku_constraint.js';
import { SudokuParser } from '../sudoku_parser.js';
import { autoSaveField } from '../util.js';
import './env.js';
import { DEFAULT_CODE, EXAMPLES } from './examples.js';

class Sandbox {
  constructor() {
    this.editorElement = document.getElementById('editor');
    this.outputElement = document.getElementById('output');
    this.constraintElement = document.getElementById('constraint-string');
    this.solverLinkElement = document.getElementById('open-solver-link');
    this.examplesSelect = document.getElementById('examples-select');

    this._initEditor();
    this._initExamples();
    this._initEventListeners();
  }

  _resultToConstraintStr(result) {
    if (Array.isArray(result)) {
      const parsed = result.map(item =>
        typeof item === 'string' ? SudokuParser.parseString(item) : item
      );
      return String(new SudokuConstraint.Set(parsed));
    }
    return String(result);
  }

  _initEditor() {
    const highlight = (editor) => {
      const code = editor.textContent;
      editor.innerHTML = Prism.highlight(code, Prism.languages.javascript, 'javascript');
    };

    this.jar = CodeJar(this.editorElement, highlight, { tab: '  ' });

    // Load saved code or use default
    autoSaveField(this.editorElement);
    this.jar.updateCode(this.editorElement.textContent || DEFAULT_CODE);

    // Save code on changes
    this.jar.onUpdate((code) => {
      this.editorElement.dispatchEvent(new Event('change'));
    });
  }

  _initExamples() {
    for (const name of Object.keys(EXAMPLES)) {
      this.examplesSelect.add(new Option(name, name));
    }
  }

  _initEventListeners() {
    document.getElementById('run-btn').addEventListener('click', () => this.runCode());
    document.getElementById('clear-btn').addEventListener('click', () => this.clear());
    document.getElementById('copy-btn').addEventListener('click', () => this._copyConstraint());

    this.editorElement.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.runCode();
      }
    });

    this.examplesSelect.addEventListener('change', () => {
      const name = this.examplesSelect.value;
      if (name) this.jar.updateCode(EXAMPLES[name]);
      this.examplesSelect.value = '';
    });
  }

  _copyConstraint() {
    const text = this.constraintElement.textContent;
    if (text && text !== '(no constraint returned)' && text !== '(error)') {
      navigator.clipboard.writeText(text);
      const resultBox = this.constraintElement.parentElement;
      resultBox.classList.add('copied');
      setTimeout(() => resultBox.classList.remove('copied'), 1000);
    }
  }

  async runCode() {
    const code = this.jar.toString();
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
      const asyncFn = new Function(`return (async () => { ${code} })();`);
      const result = await asyncFn();

      this.outputElement.textContent = logs.join('\n') || 'No console output';
      this.outputElement.className = 'output';

      if (result) {
        const constraintStr = this._resultToConstraintStr(result);
        this.constraintElement.textContent = constraintStr;

        const url = `./?q=${encodeURIComponent(constraintStr)}`;
        this.solverLinkElement.href = url;
        this.solverLinkElement.style.display = 'inline-block';

        this.outputElement.className = 'output success';
        if (logs.length === 0) {
          this.outputElement.textContent = 'Constraint generated successfully!';
        }
      } else {
        this.constraintElement.textContent = '(no constraint returned)';
        this.solverLinkElement.style.display = 'none';
      }
    } catch (err) {
      const errorOutput = logs.length > 0 ? logs.join('\n') + '\n\n' : '';
      this.outputElement.textContent = `${errorOutput}Error: ${err.message}\n\n${err.stack || ''}`;
      this.outputElement.className = 'output error';
      this.constraintElement.textContent = '(error)';
      this.solverLinkElement.style.display = 'none';
    } finally {
      Object.assign(console, originalConsole);
    }
  }

  clear() {
    this.jar.updateCode('');
    this.outputElement.textContent = '';
    this.constraintElement.textContent = '';
    this.solverLinkElement.style.display = 'none';
  }
}

new Sandbox();