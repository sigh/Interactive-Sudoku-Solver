const {
  sessionAndLocalStorage,
  clearDOMNode,
  dynamicCSSFileLoader,
} = await import('../util.js' + self.VERSION_PARAM);

await dynamicCSSFileLoader('css/debug.css' + self.VERSION_PARAM)();

const {
  InfoTextDisplay,
  CellValueDisplay,
} = await import('../display.js' + self.VERSION_PARAM);

export class DebugManager {
  constructor(displayContainer, constraintManager, bottomDrawer) {
    // External dependencies.
    this._displayContainer = displayContainer;
    this._constraintManager = constraintManager;
    this._bottomDrawer = bottomDrawer;

    // DOM.
    this._container = document.getElementById('debug-container');
    this._logView = document.getElementById('debug-logs');
    this._logLevelElem = document.getElementById('debug-log-level');
    this._countersElem = document.getElementById('counters-container');
    this._checkboxes = [
      ['exportConflictHeatmap', document.getElementById('conflict-heatmap-checkbox')],
    ];

    // State.
    this._enabled = false;
    this._shape = null;

    // UI helpers.
    this._infoOverlay = new InfoOverlay(this._displayContainer);
    this._debugCellHighlighter = this._displayContainer.createCellHighlighter(
      'debug-hover');
    this._candidateDisplay = null;

    this._initialize();
  }

  _initialize() {
    const cellPositioner = this._displayContainer.getCellPositioner();

    // UI wiring.
    this._candidateDisplay = new CellValueDisplay(
      this._displayContainer.getNewGroup('debug-candidate-group'),
      null, cellPositioner);

    // Initialize options checkboxes.
    for (const [key, element] of this._checkboxes) {
      const value = sessionAndLocalStorage.getItem(key);
      if (value !== undefined) {
        element.checked = (value === 'true');
      }
      element.onchange = () => {
        sessionAndLocalStorage.setItem(key, element.checked);
      }
    }

    // Log level selector.
    {
      const logLevelElem = this._logLevelElem;
      const value = sessionAndLocalStorage.getItem('logLevel');
      logLevelElem.value = value || '0';
      logLevelElem.onchange = () => {
        sessionAndLocalStorage.setItem('logLevel', logLevelElem.value);
      };
    }

    // Setup debug checkboxes.
    const debugCheckboxes = [
      ['debug-cell-id', (index) => this._shape.makeCellIdFromIndex(index)],
      ['debug-cell-index', (index) => index],
    ];

    for (const [id, fn] of debugCheckboxes) {
      const element = document.getElementById(id);
      const overlayValuesFn = () => {
        return [...new Array(cellPositioner.totalCells()).keys()].map(fn);
      };
      this._setInfoOverlayOnCheck(element, overlayValuesFn);
    }

    // Call reshape so that all dependencies are initialized with the shape.
    if (this._shape) {
      this.reshape(this._shape);
    }
  }

  getOptions() {
    if (!this._enabled) return null;
    const options = Object.fromEntries(
      this._checkboxes.map(
        ([k, v]) => [k, v.checked]
      )
    );
    options.logLevel = parseInt(this._logLevelElem.value, 10);
    return options;
  }

  getCallback() {
    return this._update.bind(this);
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._infoOverlay.reshape(shape);
    this._candidateDisplay.reshape(shape);
  }

  clear() {
    clearDOMNode(this._logView);
    this._infoOverlay.clear();
    this._debugCellHighlighter.clear();
    clearDOMNode(this._countersElem);

    this._logDedupe = {
      lastKey: '',
      count: 0,
      currentSpan: null,
    };
  }

  _update(data) {
    if (!this._enabled) return;

    if (data.logs) {
      const isScrolledToBottom = this._isScrolledToBottom(this._logView);

      data.logs.forEach(l => this._addLog(l, data.timeMs));

      if (isScrolledToBottom) {
        this._scrollToBottom(this._logView);
      }
    }

    if (data.conflictHeatmap) {
      this._infoOverlay.setHeatmapValues(data.conflictHeatmap);
    }

    if (data.counters) {
      this._updateCounters(data.counters);
    }
  }

  _updateCounters(counters) {
    const countersElem = this._countersElem;
    clearDOMNode(countersElem);

    for (const key of [...counters.keys()].sort()) {
      const value = counters.get(key);
      const elem = document.createElement('div');
      const label = document.createElement('span');
      label.className = 'description';
      label.textContent = key;
      const count = document.createElement('span');
      count.textContent = value;
      elem.appendChild(label);
      elem.appendChild(count);
      countersElem.appendChild(elem);
    }

    this._bottomDrawer.openTab('counters');
  }

  _isScrolledToBottom(obj) {
    return obj.scrollTop === (obj.scrollHeight - obj.offsetHeight);
  }
  _scrollToBottom(obj) {
    obj.scrollTop = obj.scrollHeight;
  }

  _addDuplicateLog(data) {
    if (!this._logDedupe.currentSpan) {
      this._logDedupe.count = 1;
      this._logDedupe.currentSpan = document.createElement('span');
      this._logDedupe.currentSpan.classList.add('duplicate-log-line');
      this._logView.append(this._logDedupe.currentSpan);
    }
    const span = this._logDedupe.currentSpan;
    const count = ++this._logDedupe.count;

    const repeatSpan = document.createElement('span');
    repeatSpan.textContent = ` x${count}`;
    this._addLogMouseOver(repeatSpan, data);

    span.append(repeatSpan);
  }

  _addLog(data, timeMs = null) {
    const argsStr = JSON.stringify(data.args || '').replaceAll('"', '');

    const key = `${data.loc} ${data.msg} ${argsStr}`;
    if (key === this._logDedupe.lastKey) {
      return this._addDuplicateLog(data);
    }
    this._logDedupe.lastKey = key;
    this._logDedupe.currentSpan = null;

    const elem = document.createElement('div');
    if (data.important) {
      elem.classList.add('important-log-line');
    }

    const locSpan = document.createElement('span');
    let locText = '';
    if (timeMs !== null && timeMs > 0) {
      const seconds = (timeMs / 1000).toFixed(3);
      locText = `[${seconds}s] `;
    }
    locText += data.loc + ': ';
    locSpan.textContent = locText;

    const msgSpan = document.createElement('msg');
    let msg = data.msg || '';
    if (data.args) {
      msg += ' ' + argsStr;
    }
    msgSpan.textContent = msg;

    elem.append(locSpan);
    elem.append(msgSpan);

    this._addLogMouseOver(elem, data);

    this._logView.append(elem);
  }

  _addLogMouseOver(elem, data) {
    const shape = this._shape;

    if (data.cells?.length) {
      const cellIds = [...data.cells].map(c => shape.makeCellIdFromIndex(c));
      elem.addEventListener('mouseover', () => {
        this._debugCellHighlighter.setCells(cellIds);
      });
      elem.addEventListener('mouseout', () => {
        this._debugCellHighlighter.clear();
      });
    }

    if (data.candidates) {
      elem.addEventListener('mouseover', () => {
        this._candidateDisplay.renderGridValues(data.candidates);
      });
      elem.addEventListener('mouseout', () => {
        this._candidateDisplay.clear();
      });
    }

    if (data.overlay) {
      this._setInfoOverlayOnHover(elem, data.overlay);
    }
  }

  _setInfoOverlayOnCheck(elem, data) {
    elem.addEventListener('change', () => {
      if (elem.checked) {
        let values = data;
        if (typeof data === 'function') values = data();
        this._infoOverlay.setAnnotations(
          values, () => elem.checked = false);
      } else {
        this._infoOverlay.setAnnotations();
      }
    });
  }

  _setInfoOverlayOnHover(elem, data) {
    elem.addEventListener('mouseover', () => {
      this._infoOverlay.setAnnotations(data);
    });
    elem.addEventListener('mouseout', () => {
      this._infoOverlay.setAnnotations();
    });
  }

  setEnabled(enabled) {
    // Show/hide the debug panel. When disabling, we also clear the UI.
    this._enabled = enabled;
    this._container.hidden = !enabled;

    this.clear();
  }
}

// Renders per-cell overlays on the grid.
//
// There are two independent text channels:
// - Annotations: controlled by debug checkboxes / hover overlays (e.g. show cell id/index).
// - Values: reserved for stack-trace hover (shows the value at each step's prefix).
//
// Keeping these separate ensures stack-trace hover never interferes with annotation toggles.
export class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createCellHighlighter();
    this._annotationText = new InfoTextDisplay(
      displayContainer.getNewGroup('debug-info-group'),
      displayContainer.getCellPositioner());
    const valueGroup = displayContainer.getNewGroup('debug-value-group');
    valueGroup.classList.add('solution-group');
    this._valueDisplay = new CellValueDisplay(valueGroup,
      null, displayContainer.getCellPositioner());

    this._onNextTextChangeFn = null;
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();

    this._annotationText.reshape(shape);
    this._valueDisplay.reshape(shape);
  }

  clear() {
    this._heatmap.clear();
    this._clearAnnotationText();
    this._clearValueText();
  }

  _clearAnnotationText() {
    this._annotationText.clear();
    if (this._onNextTextChangeFn) {
      this._onNextTextChangeFn();
      this._onNextTextChangeFn = null;
    }
  }

  _clearValueText() {
    this._valueDisplay.clear();
  }

  setHeatmapValues(values) {
    const shape = this._shape;
    this._heatmap.clear();

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      const path = this._heatmap.addCell(cellId);
      if (!path) continue;
      path.setAttribute('fill', 'rgb(255, 0, 0)');
      path.setAttribute('opacity', values[i] / 1000);
    }
  }

  // Sets the annotation overlay text.
  // If onChange is provided, it will be called the next time annotations are cleared.
  // (Used by checkbox-driven overlays so they can auto-uncheck.)
  setAnnotations(values, onChange) {
    const shape = this._shape;
    this._clearAnnotationText();
    if (onChange) this._onNextTextChangeFn = onChange;

    if (!values) return;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const cellId = shape.makeCellIdFromIndex(i);
      this._annotationText.setText(cellId, value);
    }
  }

  setValues(gridValues) {
    this._clearValueText();
    if (!gridValues) return;

    this._valueDisplay.renderGridValues(gridValues);
  }
}
