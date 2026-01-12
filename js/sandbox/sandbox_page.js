import { sessionAndLocalStorage } from '../util.js';
import { DisplayContainer, SolutionDisplay } from '../display.js';
import { ConstraintDisplay } from '../constraint_display.js';
import { SudokuParser } from '../sudoku_parser.js';
import { SolverRunner } from '../solver_runner.js';
import { EmbeddedSandbox } from './embedded_sandbox.js';

class SandboxPage extends EmbeddedSandbox {
  constructor() {
    const container = document.querySelector('.sandbox-container');
    super(container, null);

    this._constraintElement = document.getElementById('constraint-string');
    this._solverLinkElement = document.getElementById('open-solver-link');
    this._copyBtn = document.getElementById('copy-btn');

    this._gridPreview = new GridPreview(
      document.getElementById('grid-preview-container'),
      document.getElementById('grid-preview'),
      this._errorElement
    );

    this._initExtraEventListeners();
  }

  _initExtraEventListeners() {
    this._copyBtn.addEventListener('click', () => this._copyConstraint());
    document.getElementById('solve-btn').addEventListener('click', () => this._gridPreview.solve());
    document.getElementById('abort-btn').addEventListener('click', () => this._gridPreview.abort());
  }

  _copyConstraint() {
    const text = this._constraintElement.textContent;
    navigator.clipboard.writeText(text);
    const resultBox = this._constraintElement.parentElement;
    resultBox.classList.add('copied');
    setTimeout(() => resultBox.classList.remove('copied'), 1000);
  }

  _onRunSuccess(constraintStr) {
    if (constraintStr) {
      this._constraintElement.textContent = constraintStr;

      const url = `./?q=${encodeURIComponent(constraintStr)}`;
      this._solverLinkElement.href = url;
      this._solverLinkElement.style.display = 'inline-block';

      this._gridPreview.render(constraintStr);
    } else {
      this._constraintElement.textContent = '';
      this._solverLinkElement.style.display = 'none';
      this._gridPreview.hide();
    }
  }

  _onRunError(err) {
    super._onRunError(err);
    this._solverLinkElement.style.display = 'none';
    this._gridPreview.hide();
  }

  _clearOutput() {
    super._clearOutput();
    this._constraintElement.textContent = '';
    this._solverLinkElement.style.display = 'none';
    this._gridPreview.hide();
  }

  _renderConstraintLink(constraintStr, text) {
    const span = document.createElement('span');

    const link = document.createElement('a');
    link.href = `./?q=${encodeURIComponent(constraintStr)}`;
    link.target = '_blank';
    link.textContent = text;
    span.appendChild(link);

    const previewBtn = document.createElement('button');
    previewBtn.className = 'solver-link-preview';
    previewBtn.title = 'Load in preview grid';
    const img = document.createElement('img');
    img.src = 'img/pageview-48.png';
    img.alt = 'Preview';
    previewBtn.appendChild(img);
    previewBtn.onclick = () => {
      this._constraintElement.textContent = constraintStr;
      const url = `./?q=${encodeURIComponent(constraintStr)}`;
      this._solverLinkElement.href = url;
      this._solverLinkElement.style.display = 'inline-block';
      this._gridPreview.render(constraintStr);
    };
    span.appendChild(previewBtn);

    return span;
  }
}

class GridPreview {
  constructor(containerElement, previewElement, errorElement) {
    this._previewElement = previewElement;
    this._errorElement = errorElement;
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

new SandboxPage();