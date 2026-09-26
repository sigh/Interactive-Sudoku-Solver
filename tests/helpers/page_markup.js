// The constraint panels of index.html, reduced to what the code reads, for
// the fake DOM (mock_dom.js). Each builder returns a new element.

import { h } from './mock_dom.js';

export const layoutCheckboxes = () => h('div', { id: 'layout-constraint-checkboxes' },
  h('div', { id: 'layout-constraint-checkboxes-error', class: 'notice notice-error' }));

export const globalCheckboxes = () => h('div', { id: 'global-constraints-container' },
  h('h2', {}, 'Global constraints'),
  h('div', { id: 'global-constraint-checkboxes' },
    h('div', { id: 'global-constraint-checkboxes-error', class: 'notice notice-error' })));

// The Lines & Sets and Chaos Construction forms.
export const multiCellForm = (id) => () => h('form', { id },
  h('fieldset', {},
    h('h2', {}, 'Constraints'),
    h('div', {}, h('div', {},
      h('span', { class: 'description' }, 'Select cells.'),
      h('select', { id: `${id}-select`, name: 'constraint-type' }),
      h('div', { class: 'description' }),
      h('div', { class: 'constraint-loop' },
        h('input', { type: 'checkbox', name: 'is-loop' })),
      h('div', { class: 'constraint-value' }),
      h('button', { type: 'submit', name: 'add-constraint', disabled: true }),
      h('div', { class: 'notice notice-error' })))));

export const compositeForm = () => h('form', { id: 'composite-constraint-input' },
  h('fieldset', {},
    h('h2', {}, 'Composite constraints'),
    h('div', {},
      h('button', { type: 'button', name: 'add-or' }),
      h('button', { type: 'button', name: 'add-and' }),
      h('button', { type: 'button', name: 'add-replicate' }),
      h('div', { class: 'chip-view', 'data-chip-view-type': 'composite' }))));

export const regionPanel = () => h('div', {},
  h('div', {}, h('select', { id: 'region-size-select' })),
  h('div', {}, h('input', { type: 'checkbox', id: 'region-same-values-checkbox' })),
  h('div', {}, h('button', { id: 'add-jigsaw-button' })),
  h('div', { class: 'chip-view', 'data-chip-view-type': 'jigsaw' }));

export const outsideClues = () => h('div', { id: 'outside-clue-container' },
  h('h2', {}, 'Outside clues'),
  h('div', {},
    h('form', { id: 'outside-clue-input' },
      h('fieldset', { disabled: true },
        h('input', { type: 'hidden', name: 'id' }),
        h('div', { class: 'outside-arrow-clue-types' }),
        h('input', { type: 'number', name: 'value' }),
        h('button', { type: 'submit' }),
        h('button', { type: 'button', id: 'outside-arrow-clear' })))));

export const outsideClueOptions = () => h('div', { id: 'outside-clue-options' },
  h('div', { id: 'outside-clue-options-error', class: 'notice notice-error' }));

export const multiValueForm = () => h('form', { id: 'multi-value-cell-input' },
  h('fieldset', { disabled: true },
    h('h2', {}, 'Multiple values'),
    h('div')));

export const customConstraintForm = () => h('form', { id: 'custom-constraint-input' },
  h('fieldset', { id: 'custom-constraint-panel' },
    h('h2', {}, 'Custom JavaScript constraints'),
    h('div', {},
      h('div', { class: 'tab-container' },
        h('button', { type: 'button', class: 'active', 'data-tab': 'custom-pairwise-tab' }),
        h('button', { type: 'button', 'data-tab': 'state-machine-tab' })),
      h('div', { id: 'custom-pairwise-tab', class: 'tab-content active' },
        h('input', { type: 'text', name: 'pairwise-name' }),
        h('select', { name: 'chain-mode' },
          h('option', { value: 'Pair' }), h('option', { value: 'PairX' })),
        h('textarea', { name: 'function' }),
        h('div', { id: 'custom-pairwise-input-error' }),
        h('button', { type: 'button', name: 'add-pairwise-constraint' },
          h('span', { class: 'spinner' }))),
      h('div', { id: 'state-machine-tab', class: 'tab-content' },
        h('input', { type: 'text', name: 'state-machine-name' }),
        h('input', { id: 'unified-mode-input', type: 'checkbox', name: 'unified-mode' }),
        h('div', { id: 'state-machine-split-input' },
          ...['start-state', 'transition-body', 'accept-body', 'max-depth']
            .map(name => h('textarea', { name }))),
        h('div', { id: 'state-machine-unified-input' },
          h('textarea', { name: 'unified-code' })),
        h('div', { id: 'state-machine-input-error' }),
        h('button', { type: 'button', name: 'add-state-machine-constraint' },
          h('span', { class: 'spinner' }))))));

export const shapePanel = () => h('div', {},
  h('div', { id: 'shape-panel' },
    h('h2', {}, 'Shape'),
    h('div', {},
      h('input', { type: 'text', id: 'shape-input' }),
      h('div', { id: 'shape-dropdown' }, h('div', { id: 'shape-dropdown-items' })),
      h('select', { id: 'grid-type-input' }),
      h('select', { id: 'value-range-min' }),
      h('select', { id: 'value-range-max' }),
      h('form', { id: 'var-constraint-input' },
        h('input', { type: 'text', name: 'var-prefix' }),
        h('input', { type: 'text', name: 'var-count' }),
        h('input', { type: 'text', name: 'var-label' }),
        h('button', { type: 'submit', name: 'add-var' })),
      h('div', { id: 'var-constraint-input-error' }))));

export const cellGroupPanel = () => h('div', { id: 'cell-group-constraint-container' },
  h('h2', {}, 'Cell group constraints'),
  h('div', {},
    h('form', { id: 'connected-values-input' },
      h('span', { id: 'connected-values-tooltip' }),
      h('select', { name: 'cell-group' }),
      h('input', { type: 'text', name: 'values' }),
      h('input', { type: 'text', name: 'size' }),
      h('button', { type: 'submit', name: 'add-connected-values' })),
    h('div', { id: 'cell-group-constraint-error', class: 'notice notice-error' })));

// Everything ConstraintManager builds on: the grid, the free-form input, and
// the constraint panels with their buttons.
export const constraintPage = () => h('div', {},
  h('div', { id: 'sudoku-grid' }, h('input', { id: 'fake-input', type: 'text' })),
  h('input', { type: 'checkbox', id: 'dim-constraints-input' }),
  h('div', { id: 'dim-constraints-warning' }),
  h('form', { id: 'freeform-constraint-input' },
    h('div', { id: 'freeform-constraint-panel' },
      h('h2', {}, 'Load constraint from text'),
      h('div', {},
        h('div', {}, h('textarea', { name: 'freeform-input' })),
        h('button', { type: 'button', id: 'freeform-load-current-button' })))),
  h('div', { id: 'constraint-panel-container' },
    h('button', { id: 'copy-constraints-button' }),
    h('button', { id: 'clear-constraints-button' }),
    shapePanel(),
    globalCheckboxes(),
    h('div', { id: 'layout-constraint-container' },
      h('h2', {}, 'Layout constraints'),
      h('div', {}, layoutCheckboxes(), regionPanel())),
    cellGroupPanel(),
    multiValueForm(),
    multiCellForm('lines-and-sets-input')(),
    outsideClues(),
    outsideClueOptions(),
    customConstraintForm(),
    compositeForm(),
    multiCellForm('chaos-constraint-input')(),
    h('div', { class: 'chip-view', 'data-chip-view-type': 'ordinary' })));
