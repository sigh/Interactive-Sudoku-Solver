import { CodeJar } from '../../lib/codejar.js';
import { SudokuConstraint } from '../sudoku_constraint.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';
import { javascriptSpecToNFA, NFASerializer } from '../nfa_builder.js';
import { DEFAULT_CODE, EXAMPLES } from './examples.js';

// Make these available globally for sandbox code.
Object.assign(window, {
  SudokuConstraint,
  GridShape,
  SHAPE_9x9,
  SHAPE_MAX,
  javascriptSpecToNFA,
  NFASerializer,
});

class Sandbox {
  constructor() {
    this.editorElement = document.getElementById('editor');
    this.outputElement = document.getElementById('output');
    this.constraintElement = document.getElementById('constraint-string');
    this.urlElement = document.getElementById('puzzle-url');
    this.urlLinkElement = document.getElementById('puzzle-url-link');
    this.examplesSelect = document.getElementById('examples-select');

    this._initEditor();
    this._initExamples();
    this._initEventListeners();
  }

  _initEditor() {
    const highlight = (editor) => {
      const code = editor.textContent;
      editor.innerHTML = Prism.highlight(code, Prism.languages.javascript, 'javascript');
    };

    this.jar = CodeJar(this.editorElement, highlight, { tab: '  ' });

    // Load saved code or use default
    const savedCode = localStorage.getItem('sandbox-code');
    this.jar.updateCode(savedCode || DEFAULT_CODE);

    // Save code on changes
    this.jar.onUpdate((code) => {
      localStorage.setItem('sandbox-code', code);
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

    this.editorElement.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.runCode();
      }
    });

    this.constraintElement.addEventListener('click', () => this._copyToClipboard(this.constraintElement));
    this.urlElement.addEventListener('click', () => this._copyToClipboard(this.urlElement));

    this.examplesSelect.addEventListener('change', () => {
      const name = this.examplesSelect.value;
      if (name) this.jar.updateCode(EXAMPLES[name]);
      this.examplesSelect.value = '';
    });
  }

  _copyToClipboard(element) {
    navigator.clipboard.writeText(element.textContent);
    element.classList.add('copied');
    setTimeout(() => element.classList.remove('copied'), 1000);
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
        const constraintStr = String(result);
        this.constraintElement.textContent = constraintStr;

        const url = `${location.origin}${location.pathname.replace('sandbox.html', 'index.html')}#${constraintStr}`;
        this.urlElement.textContent = url;
        this.urlLinkElement.href = url;
        this.urlLinkElement.style.display = 'inline-block';

        this.outputElement.className = 'output success';
        if (logs.length === 0) {
          this.outputElement.textContent = 'Constraint generated successfully!';
        }
      } else {
        this.constraintElement.textContent = '(no constraint returned)';
        this.urlLinkElement.style.display = 'none';
      }
    } catch (err) {
      const errorOutput = logs.length > 0 ? logs.join('\n') + '\n\n' : '';
      this.outputElement.textContent = `${errorOutput}Error: ${err.message}\n\n${err.stack || ''}`;
      this.outputElement.className = 'output error';
      this.constraintElement.textContent = '(error)';
      this.urlLinkElement.style.display = 'none';
    } finally {
      Object.assign(console, originalConsole);
    }
  }

  clear() {
    this.jar.updateCode('');
    this.outputElement.textContent = '';
    this.constraintElement.textContent = '';
    this.urlElement.textContent = '';
    this.urlLinkElement.style.display = 'none';
  }
}

new Sandbox();