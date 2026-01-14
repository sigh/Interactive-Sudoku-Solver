// Sandbox editor class.

import { CodeJar } from '../../lib/codejar.min.js';
import { autoSaveField, Base64Codec } from '../util.js';
import { DEFAULT_CODE, EXAMPLES } from './examples.js';
import { UserScriptExecutor } from '../sudoku_constraint.js';
import { SANDBOX_HELP_TEXT } from './help_text.js';

export class EmbeddedSandbox {
  constructor(container, onConstraintGenerated) {
    this._container = container;
    this._editorElement = container.querySelector('.sandbox-editor');
    this._outputElement = container.querySelector('.sandbox-output');
    this._statusElement = container.querySelector('.sandbox-status');
    this._examplesSelect = container.querySelector('.sandbox-examples');
    this._runBtn = container.querySelector('.sandbox-run');
    this._abortBtn = container.querySelector('.sandbox-abort');
    this._clearBtn = container.querySelector('.sandbox-clear');
    this._shareBtn = container.querySelector('.sandbox-share');
    this._onConstraintGenerated = onConstraintGenerated;

    this._userScriptExecutor = new UserScriptExecutor();
    this._currentExecution = null;

    this._initEditor();
    this._initExamples();
    this._initEventListeners();
    this._showInitialHelp();
  }

  _showInitialHelp() {
    this._outputElement.textContent = SANDBOX_HELP_TEXT;
    this._setStatusSegments(['Showing help()']);
  }

  _renderSegments(segments) {
    const fragment = document.createDocumentFragment();
    if (!segments?.length) return fragment;

    for (let i = 0; i < segments.length; i++) {
      if (i > 0) fragment.appendChild(document.createTextNode(' '));
      const segment = segments[i];
      if (typeof segment === 'string') {
        fragment.appendChild(document.createTextNode(segment));
      } else if (segment.type === 'link') {
        fragment.appendChild(
          this._renderConstraintLink(segment.constraintStr, segment.text));
      } else if (segment.type === 'bold') {
        const strong = document.createElement('strong');
        strong.textContent = segment.text;
        fragment.appendChild(strong);
      }
    }
    return fragment;
  }

  _setStatusSegments(segments) {
    this._statusElement.classList.remove('error');
    this._statusElement.classList.add('status');
    this._statusElement.replaceChildren(this._renderSegments(segments));
  }

  _setResultStatus(constraintStr) {
    const MAX_LENGTH = 30;
    const renderedStr = constraintStr.length > MAX_LENGTH
      ? constraintStr.slice(0, MAX_LENGTH - 1) + '…' : constraintStr;

    this._setStatusSegments([
      { type: 'bold', text: 'Result:' },
      { type: 'link', constraintStr, text: renderedStr },
    ]);
  }

  _setError(text) {
    this._statusElement.classList.remove('status');
    this._statusElement.classList.add('error');
    this._statusElement.textContent = text;
  }

  _initEditor() {
    const highlight = (editor) => {
      const code = editor.textContent;
      editor.innerHTML = Prism.highlight(code, Prism.languages.javascript, 'javascript');
    };

    this._jar = CodeJar(
      this._editorElement,
      highlight,
      { tab: '  ', addClosing: false });

    // Load saved code first so it is available as a fallback.
    autoSaveField(this._editorElement);

    const savedCode = this._editorElement.textContent;

    // Load code from URL if present and non-empty, otherwise use saved code / default.
    const url = new URL(window.location);
    const encoded = url.searchParams.get('code');
    // Track if we loaded from a non-empty code param (for clearing on first edit).
    let shouldClearCodeParamOnFirstEdit = encoded !== null && encoded !== '';

    let initialCode;
    if (encoded) {
      try {
        initialCode = Base64Codec.decodeToString(encoded);
      } catch (e) {
        this._setError('Failed to decode code from URL');
        initialCode = savedCode || DEFAULT_CODE;
      }
    } else {
      initialCode = savedCode || DEFAULT_CODE;
    }

    this._jar.updateCode(initialCode);

    // Save code on changes. On first edit after loading from URL, clear the
    // code param value (but keep the param to indicate sandbox is open).
    this._jar.onUpdate(() => {
      this._editorElement.dispatchEvent(new Event('change'));
      if (shouldClearCodeParamOnFirstEdit) {
        this._setEmptyCodeParam();
        shouldClearCodeParamOnFirstEdit = false;
      }
    });
  }

  _setEmptyCodeParam() {
    const url = new URL(window.location);
    url.searchParams.set('code', '');
    window.history.replaceState({}, '', url);
  }

  _copyShareableLink() {
    const code = this._jar.toString();
    const encoded = Base64Codec.encodeString(code);
    const url = new URL(window.location);
    url.searchParams.set('code', encoded);
    navigator.clipboard.writeText(url.toString());

    this._shareBtn.classList.add('copied');
    setTimeout(() => this._shareBtn.classList.remove('copied'), 1000);
  }

  _initExamples() {
    for (const name of Object.keys(EXAMPLES)) {
      this._examplesSelect.add(new Option(name, name));
    }
  }

  _initEventListeners() {
    this._runBtn.addEventListener('click', () => this.runCode());
    this._abortBtn.addEventListener('click', () => this.abortCode());
    this._clearBtn.addEventListener('click', () => this.clear());
    this._shareBtn?.addEventListener('click', () => this._copyShareableLink());

    // Ctrl+Enter to run (but not Ctrl+Shift+Enter which is for solving).
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'Enter') {
        if (this._container.style.display !== 'none') {
          e.preventDefault();
          this.runCode();
        }
      }
    }, { capture: true });

    this._examplesSelect.addEventListener('change', () => {
      const name = this._examplesSelect.value;
      if (name) this._jar.updateCode(EXAMPLES[name]);
      this._examplesSelect.value = '';
    });
  }

  async runCode() {
    const spinner = this._runBtn.querySelector('.spinner');

    this._runBtn.disabled = true;
    this._abortBtn.disabled = false;
    spinner?.classList.add('active');
    this._clearOutput();

    const code = this._jar.toString();

    // Callbacks for streaming updates.
    const callbacks = {
      onLog: (segments) => {
        if (this._outputElement.textContent || this._outputElement.children.length) {
          this._outputElement.appendChild(document.createTextNode('\n'));
        }
        this._outputElement.appendChild(this._renderSegments(segments));
        // Auto-scroll to bottom.
        this._outputElement.scrollTop = this._outputElement.scrollHeight;
      },
      onStatus: (segments) => {
        this._setStatusSegments(segments);
      },
    };

    // Store current execution for abort.
    const executionId = this._userScriptExecutor.runSandboxCode(code, callbacks);
    this._currentExecution = executionId;

    try {
      const { constraintStr } = await executionId;
      if (constraintStr) {
        this._setResultStatus(constraintStr);
        this._onConstraintGenerated?.(constraintStr);
      }
    } catch (err) {
      this._setError(`Error: ${err.message || err}`);
    } finally {
      this._currentExecution = null;
      this._runBtn.disabled = false;
      this._abortBtn.disabled = true;
      spinner?.classList.remove('active');
    }
  }

  _renderConstraintLink(constraintStr, text) {
    const wrapper = document.createElement('span');
    wrapper.className = 'solver-link-with-copy';

    const link = document.createElement('a');
    link.href = '?q=' + encodeURIComponent(constraintStr);
    link.textContent = text;
    link.title = 'Load into grid';
    link.onclick = (e) => {
      e.preventDefault();
      this._onConstraintGenerated?.(constraintStr);
    };

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-button';
    copyBtn.title = 'Copy constraint to clipboard';
    copyBtn.setAttribute('aria-label', 'Copy constraint to clipboard');

    const copyIcon = document.createElement('img');
    copyIcon.src = 'img/copy-48.png';
    copyIcon.alt = '';
    copyBtn.appendChild(copyIcon);

    copyBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await navigator.clipboard.writeText(constraintStr);
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 800);
    };

    wrapper.appendChild(link);
    wrapper.appendChild(copyBtn);

    return wrapper;
  }

  abortCode() {
    if (this._currentExecution) {
      this._userScriptExecutor.abort();
      this._currentExecution = null;
    }
  }

  _clearOutput() {
    this._outputElement.innerHTML = '';
    this._statusElement.textContent = '';
    this._statusElement.classList.remove('status');
    this._statusElement.classList.remove('error');
  }

  clear() {
    this._jar.updateCode('');
    this._clearOutput();
  }
}
