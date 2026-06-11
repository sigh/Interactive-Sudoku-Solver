const { CompositeConstraintBase } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);

export class RawStringsPanel {
  constructor(constraintManager, displayContainer, bodyElement) {
    this._constraintManager = constraintManager;
    this._highlighter = displayContainer.createCellHighlighter(
      'raw-strings-hover');
    this._output = bodyElement.querySelector('#raw-strings-output');
    this._enabled = false;

    constraintManager.addUpdateListener(() => {
      if (this._enabled) this._update();
    });
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    if (enabled) this._update();
  }

  reshape() { }

  clear() {
    this._output.replaceChildren();
  }

  _buildRow(displayText, constraint, depth) {
    const line = document.createElement('div');
    line.className = 'raw-strings-line';
    line.style.paddingLeft = `${depth * 16}px`;

    const text = document.createElement('span');
    text.textContent = displayText;
    line.append(text);

    if (constraint) {
      line.addEventListener('mouseenter', () => {
        this._highlighter.setCells(
          constraint.getCells(this._constraintManager._shape), line);
      });
      line.addEventListener('mouseleave', () => this._highlighter.clear());
    }

    return line;
  }

  _buildRows(constraint, container, depth) {
    if (constraint instanceof CompositeConstraintBase) {
      const headerItems = [constraint.constructor.name, ...constraint.args.slice(1)];
      container.append(this._buildRow(`.${headerItems.join('~')}`, constraint, depth));
      for (const child of constraint.constraints) {
        this._buildRows(child, container, depth + 1);
      }
      container.append(this._buildRow('.End', null, depth));
    } else {
      container.append(this._buildRow(constraint.toString(), constraint, depth));
    }
  }

  _update() {
    const container = document.createElement('div');
    for (const c of this._constraintManager.getConstraints().constraints) {
      if (c.toString()) this._buildRows(c, container, 0);
    }
    this._output.replaceChildren(container);
  }
}
