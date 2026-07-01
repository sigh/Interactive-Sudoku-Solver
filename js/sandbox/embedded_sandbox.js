// Sandbox editor class.


const { CodeJar } = await import('../../lib/codejar.min.js' + self.VERSION_PARAM);
const { autoSaveField, Base64Codec, copyToClipboard } = await import('../util.js' + self.VERSION_PARAM);
const { DEFAULT_CODE, EXAMPLES } = await import('./examples.js' + self.VERSION_PARAM);
const { UserScriptExecutor } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const {
  SANDBOX_HELP_TEXT,
  SANDBOX_WARNING_TEXT
} = await import('./help_text.js' + self.VERSION_PARAM);

export class EmbeddedSandbox {
  constructor(container, onConstraintGenerated, getCurrentConstraintStr) {
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
    this._getCurrentConstraintStr = getCurrentConstraintStr;

    this._userScriptExecutor = new UserScriptExecutor();
    this._currentExecution = null;

    this._initEditor();
    this._initExamples();
    this._initEventListeners();
    this._showInitialHelp();
  }

  _setStatusVariant(variant) {
    this._statusElement.classList.toggle('notice-info', variant === 'info');
    this._statusElement.classList.toggle('notice-error', variant === 'error');
  }

  _showInitialHelp() {
    this._outputElement.textContent = `${SANDBOX_WARNING_TEXT}\n\n${SANDBOX_HELP_TEXT}`;
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
      } else if (segment.type === 'table') {
        fragment.appendChild(this._renderTable(segment));
      }
    }
    return fragment;
  }

  _renderTable(tableSegment) {
    const table = document.createElement('table');
    table.className = 'sandbox-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of tableSegment.columns || []) {
      const th = document.createElement('th');
      th.textContent = String(col);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of tableSegment.rows || []) {
      const tr = document.createElement('tr');
      for (const cellSegments of row || []) {
        const td = document.createElement('td');
        td.replaceChildren(this._renderSegments(cellSegments));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return table;
  }

  _setStatusSegments(segments) {
    this._setStatusVariant('info');
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
    this._setStatusVariant('error');
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

    installLargeSelectionHandlers(this._editorElement, this._jar);

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
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('code', encoded);
    copyToClipboard(url.toString(), this._shareBtn);
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

    // Panel toggle buttons.
    const panels = this._container.querySelector('.sandbox-panels');
    this._container.querySelector('.sandbox-toggle-editor').addEventListener('click', () => {
      panels.classList.toggle('editor-collapsed');
      panels.classList.remove('output-collapsed');
    });
    this._container.querySelector('.sandbox-toggle-output').addEventListener('click', () => {
      panels.classList.toggle('output-collapsed');
      panels.classList.remove('editor-collapsed');
    });

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
    const currentConstraintStr = String(this._getCurrentConstraintStr());

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
    const executionId = this._userScriptExecutor.runSandboxCode(
      code,
      callbacks,
      currentConstraintStr);
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
    copyBtn.className = 'copy-button plain-button';
    copyBtn.title = 'Copy constraint to clipboard';
    copyBtn.setAttribute('aria-label', 'Copy constraint to clipboard');

    const copyIcon = document.createElement('img');
    copyIcon.src = 'img/copy-48.png';
    copyIcon.alt = '';
    copyBtn.appendChild(copyIcon);

    copyBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(constraintStr, copyBtn);
    };

    wrapper.appendChild(copyBtn);
    wrapper.appendChild(link);

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
    this._setStatusVariant(null);
  }

  clear() {
    this._jar.updateCode('');
    this._clearOutput();
  }
}

// Replacing a large selection through the browser's native contenteditable path
// is O(n^2) in the number of highlighted spans, so any edit over a big selection
// (delete, type, or paste after select-all) hangs for seconds. The quadratic
// cost is in Chromium's editing pipeline: https://issues.chromium.org/issues/41475538.
// CodeJar does not work around it
// (https://github.com/antonmedv/codejar/issues/67, closed without a fix), so we
// intercept large-selection edits and apply them by re-setting the plain text (a
// single re-highlight) instead. Small selections keep the native path so
// ordinary editing is unaffected.
//
// Paste and cut are handled in the capture phase on the editor's parent, so they
// run before CodeJar's own paste/cut handlers (which would otherwise do the slow
// native replace) regardless of when this is called. Typing and deletion have no
// CodeJar counterpart, so a plain listener on the editor suffices.
const installLargeSelectionHandlers = (editor, jar) => {
  const LARGE_SELECTION_CHARS = 200;

  const largeSelectionRange = () => {
    const { start, end } = jar.save();
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    return hi - lo >= LARGE_SELECTION_CHARS ? { lo, hi } : null;
  };
  const replaceLargeSelection = (insert) => {
    const range = largeSelectionRange();
    if (!range) return false;
    const text = jar.toString();
    jar.updateCode(text.slice(0, range.lo) + insert + text.slice(range.hi));
    const caret = range.lo + insert.length;
    jar.restore({ start: caret, end: caret });
    return true;
  };

  editor.parentNode.addEventListener('paste', (e) => {
    if (!editor.contains(e.target)) return;
    const data = e.clipboardData?.getData('text/plain');
    if (data == null) return;
    if (replaceLargeSelection(data.replace(/\r\n?/g, '\n'))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });
  editor.parentNode.addEventListener('cut', (e) => {
    if (!editor.contains(e.target)) return;
    const range = largeSelectionRange();
    if (!range) return;
    e.clipboardData?.setData(
      'text/plain', jar.toString().slice(range.lo, range.hi));
    e.preventDefault();
    e.stopPropagation();
    replaceLargeSelection('');
  }, { capture: true });
  editor.addEventListener('beforeinput', (e) => {
    let insert;
    switch (e.inputType) {
      case 'insertText':
        insert = e.data ?? '';
        break;
      case 'insertParagraph':
      case 'insertLineBreak':
        insert = '\n';
        break;
      case 'deleteContentBackward':
      case 'deleteContentForward':
      case 'deleteWordBackward':
      case 'deleteWordForward':
      case 'deleteSoftLineBackward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineBackward':
      case 'deleteHardLineForward':
        insert = '';
        break;
      default:
        return;
    }
    if (replaceLargeSelection(insert)) e.preventDefault();
  });
};
