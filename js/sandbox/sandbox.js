import { CodeJar } from '../../lib/codejar.min.js';
import { autoSaveField, Base64Codec } from '../util.js';
import { DEFAULT_CODE, EXAMPLES } from './examples.js';
import { UserScriptExecutor } from '../sudoku_constraint.js';

class Sandbox {
  constructor() {
    this.editorElement = document.getElementById('editor');
    this.outputElement = document.getElementById('output');
    this.constraintElement = document.getElementById('constraint-string');
    this.solverLinkElement = document.getElementById('open-solver-link');
    this.examplesSelect = document.getElementById('examples-select');

    this._userScriptExecutor = new UserScriptExecutor();

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

    // Load saved code first so it is available as a fallback.
    autoSaveField(this.editorElement);

    const savedCode = this.editorElement.textContent;

    // Load code from URL (if present), otherwise use saved code / default.
    // If the URL has a code param but it fails to decode, leave the editor empty
    // and surface the error in the Console Output panel.
    const url = new URL(window.location);
    const encoded = url.searchParams.get('code');
    let shouldClearCodeParamOnFirstEdit = encoded !== null;

    let initialCode;
    if (encoded === null) {
      initialCode = savedCode || DEFAULT_CODE;
    } else {
      try {
        initialCode = Base64Codec.decodeToString(encoded);
      } catch (e) {
        console.error('Failed to decode code from URL:', e);
        this.outputElement.textContent = `Failed to decode code from URL: ${e.message}`;
        this.outputElement.className = 'output error';
        initialCode = '';
      }
    }

    this.jar.updateCode(initialCode);

    // Save code on changes and clear URL code parameter on first edit
    this.jar.onUpdate(() => {
      this.editorElement.dispatchEvent(new Event('change'));
      if (shouldClearCodeParamOnFirstEdit) {
        this._clearCodeFromUrl();
        shouldClearCodeParamOnFirstEdit = false;
      }
    });
  }

  _clearCodeFromUrl() {
    const url = new URL(window.location);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url);
  }

  _copyShareableLink() {
    const code = this.jar.toString();
    const encoded = Base64Codec.encodeString(code);
    const url = new URL(window.location);
    url.searchParams.set('code', encoded);
    navigator.clipboard.writeText(url.toString());

    const btn = document.getElementById('share-btn');
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1000);
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
    document.getElementById('share-btn').addEventListener('click', () => this._copyShareableLink());

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.runCode();
      }
    }, { capture: true });

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
    const btn = document.getElementById('run-btn');
    const spinner = btn.querySelector('.spinner');

    btn.disabled = true;
    spinner.classList.add('active');

    const code = this.jar.toString();

    try {
      const { constraintStr, logs } = await this._userScriptExecutor.runSandboxCode(code);

      this.outputElement.textContent = logs.join('\n') || 'No console output';
      this.outputElement.className = 'output';

      if (constraintStr) {
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
      // If we have logs from the worker, show them.
      const logs = err.logs || [];
      const errorOutput = logs.length > 0 ? logs.join('\n') + '\n\n' : '';
      this.outputElement.textContent = `${errorOutput}Error: ${err.message}`;
      this.outputElement.className = 'output error';
      this.constraintElement.textContent = '(error)';
      this.solverLinkElement.style.display = 'none';
    } finally {
      btn.disabled = false;
      spinner.classList.remove('active');
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