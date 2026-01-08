import { CodeJar } from '../../lib/codejar.min.js';
import { autoSaveField, Base64Codec, sessionAndLocalStorage } from '../util.js';
import { DEFAULT_CODE, EXAMPLES } from './examples.js';
import { UserScriptExecutor } from '../sudoku_constraint.js';
import { DisplayContainer, SolutionDisplay } from '../display.js';
import { ConstraintDisplay } from '../constraint_display.js';
import { SudokuParser } from '../sudoku_parser.js';
import { SolverRunner } from '../solver_runner.js';

class Sandbox {
  constructor() {
    this.editorElement = document.getElementById('editor');
    this.outputElement = document.getElementById('output');
    this.constraintElement = document.getElementById('constraint-string');
    this.solverLinkElement = document.getElementById('open-solver-link');
    this.examplesSelect = document.getElementById('examples-select');

    this._userScriptExecutor = new UserScriptExecutor();
    this._gridPreview = new GridPreview(
      document.getElementById('grid-preview-container'),
      document.getElementById('grid-preview')
    );

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
        this.outputElement.textContent = `Failed to decode code from URL`;
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
    document.getElementById('solve-btn').addEventListener('click', () => this._gridPreview.solve());
    document.getElementById('abort-btn').addEventListener('click', () => this._gridPreview.abort());

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
    navigator.clipboard.writeText(text);
    const resultBox = this.constraintElement.parentElement;
    resultBox.classList.add('copied');
    setTimeout(() => resultBox.classList.remove('copied'), 1000);
  }

  async runCode() {
    const btn = document.getElementById('run-btn');
    const spinner = btn.querySelector('.spinner');

    btn.disabled = true;
    spinner.classList.add('active');
    this._gridPreview.clearError();

    const code = this.jar.toString();

    try {
      const { constraintStr, logs } = await this._userScriptExecutor.runSandboxCode(code);

      this.outputElement.textContent = logs.join('\n');
      this.outputElement.className = 'output';

      if (constraintStr != null) {
        this.constraintElement.textContent = constraintStr;

        const url = `./?q=${encodeURIComponent(constraintStr)}`;
        this.solverLinkElement.href = url;
        this.solverLinkElement.style.display = 'inline-block';

        this._gridPreview.render(constraintStr);

        this.outputElement.className = 'output success';
      } else {
        this.constraintElement.textContent = '';
        this.solverLinkElement.style.display = 'none';
        this._gridPreview.hide();
      }
    } catch (err) {
      // If we have logs from the worker, show them.
      const logs = err.logs || [];
      const errorOutput = logs.length > 0 ? logs.join('\n') + '\n\n' : '';
      this.outputElement.textContent = `${errorOutput}Error: ${err.message || err}`;
      this.outputElement.className = 'output error';
      this.constraintElement.textContent = '';
      this.solverLinkElement.style.display = 'none';
      this._gridPreview.hide();
    } finally {
      btn.disabled = false;
      spinner.classList.remove('active');
    }
  }

  clear() {
    this.jar.updateCode('');
    this.outputElement.textContent = '';
    this.outputElement.className = 'output';
    this.constraintElement.textContent = '';
    this.solverLinkElement.style.display = 'none';
    this._gridPreview.clearError();
    this._gridPreview.hide();
  }
}

class GridPreview {
  constructor(containerElement, previewElement) {
    this._previewElement = previewElement;
    this._errorElement = document.getElementById('grid-preview-error');
    this._displayContainer = new DisplayContainer(containerElement);
    this._constraintStr = null;

    this._solveBtn = document.getElementById('solve-btn');
    this._abortBtn = document.getElementById('abort-btn');
    this._autoSolveCheckbox = document.getElementById('auto-solve-input');

    this._setUpAutoSolve();

    // Provide a no-op input manager stub for read-only display
    const noOpInputManager = {
      addSelectionPreserver: () => { },
      onSelection: () => { },
      setSelection: () => { },
      updateOutsideArrowSelection: () => { },
    };
    this._constraintDisplay = new ConstraintDisplay(noOpInputManager, this._displayContainer);

    // Solution display (no copy button)
    this._solutionDisplay = new SolutionDisplay(
      this._displayContainer.getNewGroup('solution-group'), null);

    // Create SolverRunner once and reuse
    this._solverRunner = new SolverRunner({
      onUpdate: (result) => {
        if (result?.solution) {
          this._solutionDisplay.setSolution(result.solution);
        }
      },
      onError: (error) => {
        this._errorElement.textContent = error;
      },
      statusHandler: (isSolving) => {
        this._solveBtn.disabled = isSolving;
        this._abortBtn.disabled = !isSolving;
      },
    });
  }

  _setUpAutoSolve() {
    // Use a separate storage key from the main solver
    this._autoSolveCheckbox.checked = (
      sessionAndLocalStorage.getItem('sandboxAutoSolve') !== 'false');

    this._autoSolveCheckbox.onchange = () => {
      const isChecked = this._autoSolveCheckbox.checked;
      sessionAndLocalStorage.setItem('sandboxAutoSolve', isChecked);
      // If just enabled and we have a constraint, solve immediately
      if (isChecked && this._constraintStr !== null && !this._solverRunner.isSolving()) {
        this.solve();
      }
    };
  }

  render(constraintStr) {
    // Abort any existing solve before rendering new constraint
    this._solverRunner.abort();

    const constraint = SudokuParser.parseText(constraintStr);
    this._constraintStr = constraintStr;

    // Clear previous state
    this._constraintDisplay.clear();
    this._solutionDisplay.setSolution();

    // Update shape based on constraint
    const shape = constraint.getShape();
    this._displayContainer.reshape(shape);
    this._constraintDisplay.reshape(shape);
    this._solutionDisplay.reshape(shape);

    // Draw each constraint
    constraint.forEachTopLevel(c => {
      if (c.constructor.DISPLAY_CONFIG) {
        this._constraintDisplay.drawConstraint(c);
      }
    });

    this._previewElement.style.display = 'block';

    // Update button state - not solving yet
    if (!this._solverRunner.isSolving()) {
      this._solveBtn.disabled = false;
      this._abortBtn.disabled = true;
    }

    // Auto-solve if enabled
    if (this._autoSolveCheckbox.checked) {
      this.solve();
    }
  }

  hide() {
    this._previewElement.style.display = 'none';
    this._constraintStr = null;
    this._solveBtn.disabled = true;
    this._abortBtn.disabled = true;
    this._solverRunner.abort();
    this.clearError();
  }

  clearError() {
    this._errorElement.textContent = '';
  }

  async solve() {
    if (this._constraintStr == null || this._solverRunner.isSolving()) return;

    const constraint = SudokuParser.parseText(this._constraintStr);
    await this._solverRunner.solve(constraint);
  }

  abort() {
    this._solverRunner.abort();
  }
}

new Sandbox();