// Cell selection on the grid, and typing into it.
const { isKeyEventFromEditableElement } = await import('../util.js' + self.VERSION_PARAM);
const { DisplayItem } = await import('./display.js' + self.VERSION_PARAM);

export class Selection {
  // Committed segments in a multi-segment selection are all drawn with the same
  // bordered style, to distinguish them from the active selection.
  static COMMITTED_SEGMENT_CLASS = 'committed-segment';

  constructor(displayContainer) {
    this._displayContainer = displayContainer;
    this._highlight = displayContainer.createCellHighlighter('selected-cells');

    // Committed segments for multi-segment selection: a RegionHighlighter per
    // segment (which also holds the segment's cells). The active selection in
    // `_highlight` is the trailing, not-yet-committed segment.
    this._committedSegments = [];

    this._clickInterceptor = displayContainer.getClickInterceptor();

    this._selectionPreservers = [this._clickInterceptor.getSvg()];

    this._geometry = null;

    this._setUpMouseHandlers(this._clickInterceptor.getSvg());

    this._callbacks = [];
  }

  // Commit the active selection as a segment and start a fresh one. No-op if
  // nothing is selected.
  commitSegment() {
    const cells = [...this._highlight.getCells()];
    if (cells.length === 0) return;

    const highlighter = this._displayContainer.createRegionHighlighter(
      Selection.COMMITTED_SEGMENT_CLASS, /* inset= */ 2);
    highlighter.setCells(cells);
    this._committedSegments.push(highlighter);

    // Clear the active highlight directly (not via setCells, which would also
    // discard the committed segments) to begin the next segment.
    this._highlight.setCells([]);
    this._runCallback(false);
  }

  // Committed segments, plus the active selection as a trailing segment if non-empty.
  getSegments() {
    const segments = this._committedSegments.map(h => h.getCells());
    const active = [...this._highlight.getCells()];
    if (active.length > 0) segments.push(active);
    return segments;
  }

  // Size of the active (in-progress, not-yet-committed) segment.
  activeSize() { return this._highlight.size(); }

  committedSegmentCount() { return this._committedSegments.length; }

  _clearCommittedSegments() {
    for (const highlighter of this._committedSegments) highlighter.clear();
    this._committedSegments = [];
  }

  setShape(geometry) { this._geometry = geometry; }

  addCallback(fn) {
    this._callbacks.push(fn);
  }

  _runCallback(finishedSelecting) {
    this._callbacks.forEach(fn => fn(this.getCells(), finishedSelecting));
  }

  setCells(cellIds) {
    // Setting the active selection wholesale resets any committed segments:
    // outside-click and post-submit clear all start over.
    this._clearCommittedSegments();
    this._highlight.setCells(cellIds);
    if (cellIds.length > 0) this._maybeAddOutsideClickListener();
    this._runCallback(false);
  }

  // Clear only the active (in-progress) selection, keeping committed segments.
  // A fresh drag thus starts the next segment rather than wiping committed ones.
  _clearActive() {
    this._highlight.setCells([]);
    this._runCallback(false);
  }

  _cellsInRect(anchorId, targetId) {
    const geometry = this._geometry;
    if (!geometry) return [anchorId, targetId];
    const a = geometry.parseCellId(anchorId);
    const b = geometry.parseCellId(targetId);
    if (!a || !b) return [anchorId, targetId];

    const graph = geometry.cellGraph();
    const posA = graph.cellPosition(a.cellIndex);
    const posB = graph.cellPosition(b.cellIndex);
    if (!posA || !posB || posA[2] !== posB[2]) return [anchorId, targetId];

    const minRow = Math.min(posA[0], posB[0]);
    const maxRow = Math.max(posA[0], posB[0]);
    const minCol = Math.min(posA[1], posB[1]);
    const maxCol = Math.max(posA[1], posB[1]);

    const topLeft = graph.traverse(posA[2], minRow, minCol);
    if (topLeft === null) return [anchorId, targetId];

    const cells = [];
    for (let dr = 0; dr <= maxRow - minRow; dr++) {
      for (let dc = 0; dc <= maxCol - minCol; dc++) {
        const cell = graph.traverse(topLeft, dr, dc);
        if (cell !== null) cells.push(geometry.makeCellIdFromIndex(cell));
      }
    }
    return cells.length > 0 ? cells : [anchorId, targetId];
  }
  // All selected cells; getSegments() keeps the per-segment structure.
  getCells() {
    return this.getSegments().flat();
  }
  size() { return this.getCells().length; }

  cellIdCenter(cellId) {
    return this._clickInterceptor.cellIdCenter(cellId);
  }

  _setUpMouseHandlers(container) {
    // Make the container selectable.
    container.tabIndex = 0;

    const cellFuzziness = 1.4 * (DisplayItem.CELL_SIZE / 2);

    let currCell = null;
    let currCenter = null;
    let isDeselecting = false;
    let isRectMode = false;
    let activePointerId = null;
    const pointerMoveFn = (e) => {
      const target = this._clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null || target === currCell) return;

      // Make current cell hitbox larger so that we can more easily
      // select diagonals without hitting adjacent cells.
      const dx = Math.abs(e.offsetX - currCenter[0]);
      const dy = Math.abs(e.offsetY - currCenter[1]);
      if (Math.max(dx, dy) < cellFuzziness) return;

      if (currCell === null && !isRectMode) {
        isDeselecting = this._highlight.getCells().some(cell => cell === target);
      }

      currCell = target;
      currCenter = this._clickInterceptor.cellIdCenter(currCell);

      if (isRectMode) {
        const anchor = [...this._highlight.getCells()][0];
        if (anchor) this._highlight.setCells(this._cellsInRect(anchor, currCell));
      } else if (isDeselecting) {
        this._highlight.removeCell(currCell);
      } else {
        this._highlight.addCell(currCell);
      }
      this._runCallback(false);
    };

    const endPointerSelection = (e) => {
      if (activePointerId === null) return;
      if (e?.pointerId !== activePointerId) return;

      container.removeEventListener('pointermove', pointerMoveFn);
      this._runCallback(true);

      try {
        container.releasePointerCapture(activePointerId);
      } catch {
        // Ignore; capture may already be released.
      }

      activePointerId = null;
      e?.preventDefault();
    };

    container.addEventListener('pointerdown', e => {
      // Only track one active pointer at a time.
      if (activePointerId !== null) return;

      isRectMode = e.ctrlKey || e.metaKey;

      if (!e.shiftKey && !isRectMode) {
        // Start a fresh active selection, but keep any committed segments.
        this._clearActive();
      }

      activePointerId = e.pointerId;
      try {
        container.setPointerCapture(activePointerId);
      } catch {
        // Ignore; capture may fail in some environments.
      }

      container.addEventListener('pointermove', pointerMoveFn);
      this._maybeAddOutsideClickListener();
      currCell = null;
      currCenter = [Infinity, Infinity];
      pointerMoveFn(e);
      e.preventDefault();
    });
    container.addEventListener('pointerup', endPointerSelection);
    container.addEventListener('pointercancel', endPointerSelection);
    container.addEventListener('lostpointercapture', endPointerSelection);
    container.addEventListener('touchmove', e => {
      if (e.touches.length === 1) e.preventDefault();
    });

    {
      let outsideClickListenerEnabled = false;
      const outsideClickListener = e => {
        // Don't do anything if the click is inside one of the elements where
        // we want to retain clicks.
        for (const elem of this._selectionPreservers) {
          if (elem.contains(e.target)) return;
        }
        // Otherwise clear the selection.
        this.setCells([]);
        document.body.removeEventListener('click', outsideClickListener);
        outsideClickListenerEnabled = false;
      };
      this._maybeAddOutsideClickListener = () => {
        if (!outsideClickListenerEnabled) {
          document.body.addEventListener('click', outsideClickListener);
          outsideClickListenerEnabled = true;
        }
      }
    }
  }

  addSelectionPreserver(elem) {
    this._selectionPreservers.push(elem);
  }
}

export class GridInputManager {
  constructor(displayContainer) {
    this._geometry = null;

    this._callbacks = {
      onNewDigit: [],
      onSelection: [],
      onOutsideArrowSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._setUpPanelFocusTracking();

    this._selection = new Selection(displayContainer);
    this._selection.addCallback((cellIds, finishedSelecting) => {
      if (cellIds.length === 1) {
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
      }
      // Run callbacks first so panels can update their state.
      this._runCallbacks(
        this._callbacks.onSelection, cellIds, finishedSelecting);
      // Then restore focus based on the updated state.
      if (finishedSelecting) {
        if (cellIds.length === 1) {
          fakeInput.select();
        } else {
          // For multi-cell selections, restore focus to the last active panel.
          this._restorePanelFocus();
        }
      }
    });

    this._setUpKeyBindings();
    this._setUpSelectionControls();
  }

  // General selection controls under the grid: commit the active selection as a
  // segment (for multi-segment constraints). Available regardless of focus/panel.
  _setUpSelectionControls() {
    const container = document.getElementById('selection-controls');
    const button = document.getElementById('commit-segment-button');
    const clearButton = document.getElementById('clear-selection-button');
    const readout = document.getElementById('selection-segment-readout');
    if (!button) return;

    // Clicking the controls must not clear the selection (outside-click handler).
    this.addSelectionPreserver(container);
    button.onclick = () => this._selection.commitSegment();
    clearButton.onclick = () => this._selection.setCells([]);
    this.onSelection(() => {
      const count = this._selection.getSegments().length;
      // Clear and the count are only shown once there are committed segments.
      const hasCommitted = this._selection.committedSegmentCount() > 0;
      button.disabled = this._selection.activeSize() === 0;
      clearButton.style.display = hasCommitted ? '' : 'none';
      readout.textContent = hasCommitted
        ? `${count} segment${count === 1 ? '' : 's'}` : '';
    });
  }

  // Track which panel the user last interacted with, so we can restore focus
  // after grid selection. Panels register with a container and a function that
  // returns the element to focus (or null if focus shouldn't be restored).
  _setUpPanelFocusTracking() {
    this._getSelectionFocusTarget = null;

    // Clear on any click within the constraint panel (capture phase).
    // Panel-specific handlers then set it if the click is within them.
    const constraintPanel = document.getElementById('constraint-panel-container');
    constraintPanel.addEventListener('click', () => {
      this._getSelectionFocusTarget = null;
    }, /* useCapture= */ true);
  }

  _restorePanelFocus() {
    const target = this._getSelectionFocusTarget && this._getSelectionFocusTarget();
    if (!target) return;
    target.focus({ preventScroll: true });
    target.select?.();
  }

  reshape(geometry) {
    this._geometry = geometry;
    this._selection.setShape(geometry);
  }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
  onSelection(fn) { this._callbacks.onSelection.push(fn); }
  onOutsideArrowSelection(fn) { this._callbacks.onOutsideArrowSelection.push(fn); }

  updateOutsideArrowSelection(arrowId) {
    this._runCallbacks(this._callbacks.onOutsideArrowSelection, arrowId);
  }

  addSelectionPreserver(obj) {
    this._selection.addSelectionPreserver(obj);
  }
  registerFocusPanel(container, getFocusTarget) {
    container.addEventListener('click', () => {
      this._getSelectionFocusTarget = getFocusTarget;
    });
  }
  setSelection(cells) {
    this._selection.setCells(cells);
  }
  getSelection() {
    return [...this._selection.getCells()];
  }
  getSelectionSegments() {
    return this._selection.getSegments();
  }

  _runCallbacks(callbacks, ...args) {
    for (const callback of callbacks) {
      callback(...args);
    }
  }

  _setUpKeyBindings() {
    const getActiveCell = () => {
      let cells = [...this._selection.getCells()];
      if (cells.length !== 1) return null;
      return cells[0];
    };

    const updateActiveCellValue = (value) => {
      const cell = getActiveCell();
      if (!cell) return;

      if (value === '') {
        this._runCallbacks(this._callbacks.onNewDigit, cell, null);
        return;
      }

      const digit = parseInt(value);
      if (!Number.isNaN(digit)) {
        this._runCallbacks(this._callbacks.onNewDigit, cell, digit);
      }
    }

    const moveActiveCell = (dr, dc) => {
      let cell = getActiveCell();
      if (!cell) return;

      const geometry = this._geometry;
      const { cellIndex } = geometry.parseCellId(cell);

      const next = geometry.cellGraph().wrappingTraverse(cellIndex, dr, dc);
      this._selection.setCells([geometry.makeCellIdFromIndex(next)]);
    };

    let fakeInput = this._fakeInput;
    fakeInput.addEventListener('input', event => {
      updateActiveCellValue(fakeInput.value);

      // Ensure that any user input results in a value which makes sense to us:
      //   - Select so that the ensure content is replaced by the new value.
      //   - Initialize with x, so that backspace can be detected.
      fakeInput.value = 'x';
      fakeInput.select();
      return;
    });

    fakeInput.addEventListener('keydown', event => {
      fakeInput.select(); // Restore the selection.
      switch (event.key) {
        // Arrow keys.
        case 'ArrowLeft':
          moveActiveCell(0, -1);
          return;
        case 'ArrowRight':
          moveActiveCell(0, 1);
          return;
        case 'ArrowUp':
          moveActiveCell(-1, 0);
          return;
        case 'ArrowDown':
          moveActiveCell(1, 0);
          return;
      }
    });

    window.addEventListener('keydown', event => {
      if (isKeyEventFromEditableElement(event)) return;
      if (this._selection.size() === 0) return;
      switch (event.key) {
        case 'Backspace':
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onNewDigit, cell, null);
          }
          break;

        case 'f':
          let i = 1;
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onNewDigit, cell, i / 10 | 0);
            this._runCallbacks(this._callbacks.onNewDigit, cell, i % 10);
            i++;
          }
          break;
      }
    });
  }
}
